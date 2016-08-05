var http = require('http');
var urllib = require('url');
var qs = require('querystring');
var fs = require('fs');

var delayedResponse = 1500; // delay impeding denial of service / brute force attacks

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
	}, delayedResponse);
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

	if(path.indexOf('..')>=0) {
		resp.writeHead(403);
		return resp.end('Forbidden');
	}
	if(!basePath)
		basePath = __dirname;
	fs.readFile(basePath + '/'+path, function (err,data) {
	if (err) {
		resp.writeHead(404);
		return resp.end(JSON.stringify(err));
	}
	var headers = { 'Content-Type':inferMime(path) };
	resp.writeHead(200, headers);
	resp.end(data);
});
}

function parseArgs(args, defaults) {
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


var chatServer = require('./CometSocketServer').createServer('chat', function(info) {
	console.log('verifySocket', info.req.params);
	var params = info.req.params;
	if(!params.name || !params.channel)
		return false;
	return true;
});

chatServer.chats = { };

chatServer.on('connection', function(socket) {
	var channel = socket.params.channel;

	var chat = chatServer.chats[channel];
	if(!chat)
		chat = chatServer.chats[channel] = new Chat();
	chat.connect(socket);
});


//------------------------------------------------------------------
var settings = {
	port:8888
}
if(!parseArgs(process.argv.slice(2), settings))
	process.exit(-1);

var server = exports.server = http.createServer(function(req, resp) {
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
			protocol:req.connection.encrypted ? 'https' : 'http',
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
			return chatServer.handleRequest(request, resp);
		case 'static':
			if(path.length!=2)
				return respond(resp, 404, "Not Found");
			return serveStatic(resp, path[1], __dirname+'/'+path[0]);
		default:
			return respond(resp, 404, "Not Found");
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
server.listen(settings.port, '0.0.0.0');
console.log('Server listening at port', settings.port);

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
