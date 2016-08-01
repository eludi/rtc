var fs = require('fs');
var http = require('http');
var urllib = require('url');
var WebSocketServer = require('ws').Server;

var server_ip_address = process.env.OPENSHIFT_NODEJS_IP || '0.0.0.0';
var server_port = process.env.OPENSHIFT_NODEJS_PORT || 8888;

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

// ----------------------------------------------------------------------------------------

// create a server for the client html page
var httpServer = http.createServer(function(req, resp) {
	var url = urllib.parse(req.url, true);

	var path = url.pathname.substr(1).split('/');
	if(path.length && path[path.length-1]=='')
		path.pop();
	if(!path.length || path[0]=='index.html')
		path = [ 'static', 'index.html' ];
	var transportLayer = req.connection.encrypted ? 'https' : 'http';
	console.log(transportLayer, '>>', req.url);

	switch(path[0]) { // toplevel services:
	case 'hello':
		resp.writeHead(200, {'Content-Type': 'text/plain'});
		resp.end('Hello, world.\n');
		return;
	case 'static':
		if(path.length==2)
			return serveStatic(resp, path[1], __dirname+'/'+path[0]);
		break;
	default:
		break;
	}
	setTimeout(function() { // thwart brute force attacks
		resp.writeHead(404, { 'Cache-Control': 'no-cache, no-store, must-revalidate, proxy-revalidate', 'Pragma':'no-cache' });
		resp.end("Not Found");
	}, 1000);
});
httpServer.listen(server_port, server_ip_address, function () {
	console.log( "Listening on " + server_ip_address + ":" + server_port )
});


// ----------------------------------------------------------------------------------------

function verifyClient(info) {
	console.log('client \n\torigin:', info.origin, '\n\tsecure:', info.secure,
		'\n\tuser-agent:', info.req.headers["user-agent"],
		'\n\thost:', info.req.headers.host,
		'\n\turl:', info.req.url);
	return true;
}

// Create a server for handling websocket calls
var wss = new WebSocketServer({server: httpServer, verifyClient:verifyClient});
wss.channels = { };

wss.on('connection', function(ws) {
	var server = this;
	
	var url = urllib.parse(ws.upgradeReq.url, true);
	var channelKey = ws.path = url.pathname.substr(1);
	console.log('connect path:',channelKey, 'params:', url.query);
	if(!('name' in url.query)) {
		console.error('socket rejected. name parameter required');
		return ws.destroy();
	}
	var name = ws.name = url.query.name;

	ws.sendEvent = function(event, data) {
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
	channel.push(ws);

	ws.on('message', function(msg) {
		console.log('ws',this.path, this.name,'>>', msg);
		msg = JSON.parse(msg);
		var evt = msg.event;
		delete msg.event;
		msg.name = this.name;
		server.broadcast(this.path, evt, msg);
	});

	ws.on('close', function(code, msg) {
		console.log('ws close', code, msg);
		var channel = server.channels[this.path];
		if(channel.length>1) {
			channel.splice(channel.indexOf(this),1);
			server.broadcast(this.path, 'disconnect', { name:this.name });
		}
		else {
			delete server.channels[this.path];
			console.log('channel', this.path,'deleted');
		}
	});

	var peers = [ ];
	for(var i=0, end=channel.length ; i<end; ++i)
		peers.push(channel[i].name);
	server.broadcast(channelKey, 'connect', { name:name, peers:peers });
});

wss.broadcast = function(channel, event, data) {
	for(var i in this.channels[channel])
		this.clients[i].sendEvent(event, data);
};

