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
		'http://rtc-eludi.rhcloud.com',
		'http://eludi.net',
		'http://5.135.159.179',
		'http://eludi.cygnus.uberspace.de',
		'https://eludi.cygnus.uberspace.de',
	],
	delayedResponse: 1500, // delay impeding denial of service / brute force attacks
	devMode: false,
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

if(!parseArgs(process.argv.slice(2), cfg))
	process.exit(-1);
if(cfg.devMode) {
	cfg.allowOrigin.push('http://127.0.0.1');
	cfg.allowOrigin.push('http://localhost');
}

//--- chat server --------------------------------------------------

function Chat() {
	var self = this;

	this.connect = function(socket) {
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

	var params = urllib.parse(info.req.url, true).query;
	if(!params.name || !params.channel)
		verified = false;
	console.log(verified? '\t-> accepted':'\t-> rejected');
	return verified;
}


var chatServer = require('./CometSocketServer').createServer('/chat', verifyClient);

chatServer.chats = new Map();

chatServer.connect = function(socket) {
	var key = socket.params.channel;
	var chat = this.chats.get(key);
	if(!chat) {
		chat = new Chat();
		this.chats.set(key, chat);
	}
	chat.connect(socket);
}
chatServer.collectGarbage = function() {
	this.chats.forEach(function(chat, key, chats) {
		if(chat.peers.size)
			return;
		chats.delete(key);
		console.log('channel', key, 'cleaned up.');
	});
}
chatServer.gc = setInterval(function(self) { self.collectGarbage(); }, 10000, chatServer);
chatServer.on('connection', function(socket) { chatServer.connect(socket); });

//------------------------------------------------------------------
function EventSocketWS(websocket, key, params) {
	this.key = key;
	this.params = params;
	this.callbacks = {};
	this.ws = websocket;

	this.on = function(event, callback) {
		if(typeof callback=='function')
			this.callbacks[event]=callback;
		else if(!callback && this.callbacks[event])
			delete this.callbacks[event];
	}
	this.notify = function(event, data) {
		var callback = this.callbacks[event];
		if(!callback)
			callback = this.callbacks['*'];
		if(!callback)
			return;
		if(data && typeof data == 'string' && (data[0]=='{' || data[0]=='[' ))
			data = JSON.parse(data);
		callback(data, event);
	}
	this.emit = function(event, data) {
		var msg = { event:event };
		if(data)
			msg.data = data;
		this.ws.send(JSON.stringify(msg));
	}
	this.close = function(code, reason) {
		this.ws.close(code, reason);
		this.notify('close', data);
	}

	var self = this;
	websocket.on('message', function(msg) {
		console.log('ws', self.params.name+'@'+self.key,'>>', msg);
		msg = JSON.parse(msg);
		self.notify(msg.event, msg.data);
	});
	websocket.on('close', function(code, reason) {
		console.log('ws close', code, reason);
		self.notify('close', { code:(code===undefined) ? 1000 : code, reason: reason ? reason : '' });
	});
}

//------------------------------------------------------------------
var httpServer = http.createServer(function(req, resp) {
	// parse request:
	var params = {};
	var handle = function() {
		var url = urllib.parse(req.url, true);
		if(req.method!='POST')
			params = url.query;

		if(cfg.isOpenshift && url.port!=8000) { // redirect necessary for working websockets
			res.writeHead(301, { 'Location': 'http://'+url.hostname+':8000'+url.path+url.hash });
			return res.end();
		}

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

wss.on('connection', function(ws) {
	var url = urllib.parse(ws.upgradeReq.url, true);
	var key = url.pathname.substr(1);
	var params = url.query;
	console.log('ws connect key:',key, 'params:', params);

	var socket = new EventSocketWS(ws, key, params);
	chatServer.connect(socket);
});
