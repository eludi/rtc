var http = require('http');
var urllib = require('url');
var qs = require('querystring');
var fs = require('fs');
var WebSocketServer = require('ws').Server;

var cfg = {
	ip: process.env.OPENSHIFT_NODEJS_IP || '0.0.0.0',
	port:	process.env.OPENSHIFT_NODEJS_PORT || 8888,
	isOpenshift: (process.env.OPENSHIFT_NODEJS_IP!=null),
	allowOrigin: [
		'http://127.0.0.1', 
		'http://localhost', 
		'http://chat-eludi.rhcloud.com',
		'http://rtc-eludi.rhcloud.com',
		'http://eludi.net',
		'http://5.135.159.179',
	],
	delayedResponse: 1500, // delay impeding denial of service / brute force attacks
};


///------------------------------------------------------------------
function respond(resp, code, body) {
	var headers = { 'Cache-Control': 'no-cache, no-store, must-revalidate, proxy-revalidate', 'Pragma':'no-cache' };
	headers['Access-Control-Allow-Origin']='*';
	if(body) 
		headers['Content-Type']='application/json';
	console.log('>>', code, body);
	if(code==204) {
		resp.writeHead(code, headers);
		resp.end();
	}
	else if(code==200) {
		resp.writeHead(code, headers);
		resp.end((typeof body == 'object') ? JSON.stringify(body) : body);
	}
	else setTimeout(function() { // thwart brute force attacks
		resp.writeHead(code, headers);
		resp.end('{"status":'+code+',"error":"'+body+'"}');
	}, cfg.delayedResponse);
}

function serveStatic(resp, path, basePath) {
	var inferMime = function(fname) {
		switch(fname.substr(fname.lastIndexOf('.')+1).toLowerCase()) {
		case 'js':
			return 'application/javascript';
		case 'json':
			return 'application/json';
		case 'html':
			return 'text/html';
		case 'txt':
			return 'text/plain';
		case 'css':
			return 'text/css';
		case 'png':
			return 'image/png';
		case 'jpg':
			return 'image/jpg';
		case 'gif':
			return 'image/gif';
		default:
			return console.log('WARNING mime-type unknown for ',fname);
		}
	}

	if(path.indexOf('..')>=0)
		return respond(resp,403, 'Forbidden');
	if(!basePath)
		basePath = __dirname;
	fs.readFile(basePath + '/'+path, function (err,data) {
		if (err)
			return respond(resp, 404, JSON.stringify(err));
		var headers = { 'Content-Type':inferMime(path) };
		resp.writeHead(200, headers);
		resp.end(data);
	});
}


function parseArgs(args, settings) {
	function err() {
		console.error('ERROR arguments expected  as --arg1 value1 --argn value_n...');
		return false;
	}

	if(!args.length)
		return true;

	for(var i=0; i+1<args.length; i+=2) {
		if(args[i].substr(0,2)!='--')
			return err();
		var key = args[i].substr(2), value=args[i+1];
		if(!(key in settings))
			console.warn('WARNING ignoring unrecognized argument key', key);
		else
			settings[key]=value;
	}
	return true;
}

//--- chat server --------------------------------------------------

function Chat() {
	var self = this;

	this.connect = function(socket) {
		socket.on('close', function(data, event) { 
			delete self.peers[socket.key];
			self.broadcast(socket, 'disconnect', data);
		});
		socket.on('*', function(data, event) { self.broadcast(socket, event, data); });

		this.peers[socket.key] = socket;

		var peers = [];
		for(var key in this.peers)
			peers.push(this.peers[key].params.name);

		this.broadcast(socket, 'connect', { peers:peers });
	}

	this.broadcast = function(socket, event, payload) {
		payload.name = socket.params.name;
		for(var key in this.peers) {
			var peer = this.peers[key];
			peer.emit(event, payload);
		}
	}

	this.peers = { };
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

	var params = urllib.parse(info.req.url, true).query;
	if(!params.name || !params.channel)
		verified = false;
	console.log(verified? '\t-> accepted':'\t-> rejected');
	return verified;
}


var chatServer = require('./CometSocketServer').createServer('/chat', verifyClient);

chatServer.chats = { };

chatServer.on('connection', function(socket) {
	var channel = socket.params.channel;

	var chat = chatServer.chats[channel];
	if(!chat)
		chat = chatServer.chats[channel] = new Chat();
	chat.connect(socket);
});


//------------------------------------------------------------------
if(!parseArgs(process.argv.slice(2), cfg))
	process.exit(-1);

var httpServer = http.createServer(function(req, resp) {
	// parse request:
	var params = {};
	var handle = function() {
		var url = urllib.parse(req.url, true);
		if(req.method!='POST')
			params = url.query;
		if(params.data && typeof params.data == 'string'
			&& (params.data[0]=='{' || params.data[0]=='[' || params.data[0]=='"' ))
			params.data = JSON.parse(params.data);

		var path = url.pathname.substr(1).split('/');
		if(path.length && path[path.length-1]=='')
			path.pop();
		var request = { 
			path:path, 
			params: params, 
			method:req.method,
			protocol:(cfg.isOpenshift && req.headers['x-forwarded-proto']=='https') ? 'https' : 'http',
			ip:('x-forwarded-for' in req.headers) ? req.headers['x-forwarded-for'] : req.connection.remoteAddress,
			timestamp: new Date().getTime()
		};
		console.log(JSON.stringify(request))

		// index.html
		if(!path.length || path[0]=='index.html')
			path = request.path = [ 'static', 'chat.html' ];

		switch(path[0]) { // toplevel services:
		case 'hello':
			resp.writeHead(200, {'Content-Type': 'text/plain'});
			resp.write(JSON.stringify(request)+'\n');
			resp.end('Hello, world.\n');
			return;
		case 'chat':
			return chatServer.handleRequest(req, resp);
		case 'static':
			if(path.length==2)
				return serveStatic(resp, path[1], __dirname+'/'+path[0]);
		default:
			respond(resp, 404, "Not Found");
		}
	}
	if(req.method!='POST') 
		return handle();
	var body = '';
	req.on('data', function (data) {
		body += data;
		if (body.length > 1e6) { // avoid flood attack
			resp.writeHead(413, {'Content-Type': 'text/plain'}).end();
			req.connection.destroy();
		}
	});
	req.on('end', function () {
		params = qs.parse(body);
		handle();
	});
});
httpServer.listen(cfg.port, cfg.ip);
console.log('Server listening at', cfg.port);

function shutdown() {
	console.log( "\nshutting down..." )
	// some other closing procedures go here
	process.exit( )
}
if(process.platform==='win32') {
	var tty = require("tty");
	process.openStdin().on("keypress", function(chunk, key) { // Windows
		if(key && key.name === "c" && key.ctrl)
			return shutdown();
	})
}
else {
	process.on( 'SIGINT', shutdown);
	process.on( 'SIGTERM', shutdown);
}

//------------------------------------------------------------------
// Create a server for handling websocket calls
var wss = new WebSocketServer({server: httpServer, verifyClient:verifyClient});
wss.channels = { };

wss.on('connection', function(socket) {
	var server = this;

	var url = urllib.parse(socket.upgradeReq.url, true);
	var channelKey = socket.key = url.pathname.substr(1);
	socket.params = url.query;
	console.log('ws connect key:',channelKey, 'params:', url.query);

	socket.sendEvent = function(event, data) {
		var msg = { event:event };
		if(data)
			msg.data = data;
		this.send(JSON.stringify(msg));
	}

	var channel;
	if(channelKey in this.channels)
		channel = this.channels[channelKey];
	else
		channel = this.channels[channelKey] = [ ];
	channel.push(socket);

	socket.on('message', function(msg) {
		console.log('ws', this.params.name+'@'+this.key,'>>', msg);
		msg = JSON.parse(msg);

		var evt = msg.event;
		var data = msg.data;
		data.name = this.params.name;
		server.broadcast(this.key, evt, data);
	});

	socket.on('close', function(code, msg) {
		console.log('ws close', code, msg);
		var channel = server.channels[this.key];
		if(channel.length>1) {
			channel.splice(channel.indexOf(this),1);
			server.broadcast(this.key, 'disconnect', { name:this.params.name });
		}
		else {
			delete server.channels[this.key];
			console.log('channel', this.key,'deleted');
		}
	});

	var peers = [ ];
	for(var i=0, end=channel.length ; i<end; ++i)
		peers.push(channel[i].params.name);
	server.broadcast(channelKey, 'connect', { name:socket.params.name, peers:peers });
});

wss.broadcast = function(channel, event, data) {
	for(var i in this.channels[channel])
		this.clients[i].sendEvent(event, data);
}
