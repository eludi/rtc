var WebSocketServer = require('ws').Server;
var httpUtils = require('./httpUtils');
var EventSocketWS = require('./EventSocketWS');

var cfg = {
	ip: process.env.OPENSHIFT_NODEJS_IP || '0.0.0.0',
	port:	process.env.OPENSHIFT_NODEJS_PORT || 8888,
	isOpenshift: (process.env.OPENSHIFT_NODEJS_IP!=null),
	allowOrigin: [
		'http://rtc-eludi.rhcloud.com',
		'https://rtc-eludi.rhcloud.com',
		'http://eludi.net',
		'http://5.135.159.179',
		'http://eludi.cygnus.uberspace.de',
		'https://eludi.cygnus.uberspace.de',
	],
	devMode: false,
};

if(!httpUtils.parseArgs(process.argv.slice(2), cfg))
	process.exit(-1);
if(cfg.devMode) {
	cfg.allowOrigin.push('http://127.0.0.1');
	cfg.allowOrigin.push('http://localhost');
}

//--- p2p server ---------------------------------------------------

function P2PChannel(numPeersMax) {
	var self = this;

	this.connect = function(socket) {
		if(this.peers.size>=this.numPeersMax)
			return socket.close(1008, "too many peers");

		socket.on('close', function(data, event) {
			self.peers.delete(socket.key);
			self.broadcast(socket, 'disconnect', data);
		});
		socket.on('*', function(data, event) { self.broadcast(socket, event, data); });

		this.peers.set(socket.key, socket);

		var peers = [];
		this.peers.forEach(function(peer) { peers.push(peer.params.name); });

		this.broadcast(socket, 'connect', { peers:peers });
	}

	this.broadcast = function(socket, event, payload) {
		payload.name = socket.params.name;
		this.peers.forEach(function(peer) { peer.emit(event, payload); });
	}

	this.numPeersMax = numPeersMax || Number.MAX_SAFE_INTEGER;
	this.peers = new Map();
}

function verifyClient(info) {
	console.log('client \n\torigin:', info.origin,
		'\n\tsecure:', info.secure,
		'\n\thost:', info.req.headers.host,
		'\n\turl:', info.req.url);

	var verified = false;
	for(var i=0, end=cfg.allowOrigin.length; i<end && !verified; ++i)
		if(info.origin.indexOf(cfg.allowOrigin[i])==0)
			verified = true;

	var params = httpUtils.parseUrl(info.req.url).query;
	if(!params.name || !params.channel)
		verified = false;
	console.log(verified? '\t-> accepted':'\t-> rejected');
	return verified;
}


var p2pServer = require('./CometSocketServer').createServer('/p2p', verifyClient);

p2pServer.channels = new Map();

p2pServer.connect = function(socket) {
	var key = socket.params.channel;
	console.log('p2pServer.connect', key, this.channels.has(key), this.channels.get(key));
	var channel = this.channels.get(key);
	if(!channel) {
		channel = new P2PChannel(socket.params.numPeersMax);
		this.channels.set(key, channel);
	}
	channel.connect(socket);
}
p2pServer.collectGarbage = function() {
	this.channels.forEach(function(channel, key, channels) {
		if(channel.peers.size)
			return;
		channels.delete(key);
		console.log('channel', key, 'cleaned up.');
	});
}
p2pServer.gc = setInterval(function(self) { self.collectGarbage(); }, 10000, p2pServer);
p2pServer.on('connection', function(socket) { p2pServer.connect(socket); });

//------------------------------------------------------------------

var httpServer = httpUtils.createServer(cfg.ip, cfg.port,
	function(req, resp, url) {
		// index.html
		if(!url.path.length || url.path[0]=='index.html')
			url.path = [ 'static', 'chat.html' ];

		switch(url.path[0]) { // toplevel services:
		case 'hello':
			resp.writeHead(200, {'Content-Type': 'text/plain'});
			resp.write(req.method+' '+JSON.stringify(url)+'\n');
			return resp.end('Hello, world.\n');
		case 'p2p':
			return p2pServer.handleRequest(req, resp, url);
		case 'static':
			if(url.path.length==2)
				return httpUtils.serveStatic(resp, url.path[1], __dirname+'/'+url.path[0]);
		default:
			httpUtils.respond(resp, 404, "Not Found");
		}
	},
	function(req, protocol, url) {
		if(cfg.isOpenshift && req.headers['x-forwarded-port']!='8443') { // redirect necessary for working websockets
			var redirect = 'https://'+req.headers['x-forwarded-host']+':8443'+url.pathname;
			if(url.hash)
				redirect += url.hash;
			return redirect;
		}
		return false;
	});

httpUtils.onShutdown(function() { console.log( "\nshutting down..." ); });

//------------------------------------------------------------------
// Create a server for handling websocket calls
var wss = new WebSocketServer({server: httpServer, verifyClient:verifyClient});

wss.on('connection', function(ws) {
	var url = httpUtils.parseUrl(ws.upgradeReq.url);
	console.log('ws connect path:', url.path, 'params:', url.query);

	if(url.pathname==p2pServer.path)
		p2pServer.connect(new EventSocketWS(ws, url.query));
	else
		console.error('no handler defined for websocket path', url.path);
});
