var urllib = require('url');

function respond(resp, code, body) {
	var headers = { 'Cache-Control': 'no-cache, no-store, must-revalidate, proxy-revalidate', 'Pragma':'no-cache', 'Access-Control-Allow-Origin':'*' };
	if(body) 
		headers['Content-Type']='application/json';
	resp.writeHead(code, headers);
	if(code==204)
		resp.end();
	else if(code!=200)
		resp.end('{"status":'+code+',"error":"'+body+'"}');
	else
		resp.end((typeof body == 'object') ? JSON.stringify(body) : body);
	console.log('>>', code, body);
	return true;
}


var sockets = { };
var timeoutPresence = 4000;
var timeoutClose = 25000;

function Socket(key, params) {
	this.key = key;
	this.params = params;
	this.journal = [];
	this.rowid = 0;
	this.request = null;
	this.callbacks = {};
	this.readyState = 1;
	this.present = false;

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
		if(this.readyState != 1)
			return;

		var evt = { event:event };
		if(data)
			evt.data = data;

		this.journal.push(evt);
		if(this.request) {
			respond(this.request.resp, 200, [evt]);
			clearTimeout(this.request.timeout);
			this.request = null;
			this.expectReconnect(false);
		}
	}
	this.close = function(code, reason) {
		if(this.readyState != 1)
			return;
		var data = { code:(code===undefined) ? 1000 : code, reason: reason ? reason : '' };
		this.setPresent(false);
		this.emit('close', data);
		this.notify('close', data);
		this.readyState = 2;
		console.log('socket '+key+' closed, reason:', reason);
		delete sockets[key];
	}
	this.setPresent = function(isPresent) {
		if(this.timeout) {
			clearTimeout(this.timeout);
			delete this.timeout;
		}
		if(this.present == isPresent)
			return;
		console.log('socket '+key+' PRESENT:', isPresent);
		this.present = isPresent;
		this.notify('present', { state:isPresent });
		if(!isPresent && this.readyState==1)
			this.expectReconnect(true);
	}
	this.expectReconnect = function(closeSocket) {
		var deltaT = closeSocket ? timeoutClose : timeoutPresence;
		if(this.timeout)
			clearTimeout(this.timeout);
		var socket = this;
		this.timeout = setTimeout(function() {
			if(closeSocket) {
				if(socket.readyState==1)
					socket.close(1004, 'reconnect timeout');
			}
			else
				socket.setPresent(false);
		}, deltaT);
	}
}

function Server(path, verifyClient) {
	this.path = path;
	this.verifyClient = verifyClient;
	this.callbacks = { };
	this.timeoutRequest = 25000;

	this.guid = function() {
		var s4 = function() {
			return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
		}
		return s4() + s4() + s4() + s4() + s4() + s4() + s4() + s4();
	}

	this.createSocket = function(req, url, resp) {
		var protocol = (req.headers['x-forwarded-proto']=='https') ? 'https' : 'http';
		var origin = req.headers.origin || req.headers.referer || '';
		var info = { req:req, secure:protocol=='https', origin:origin };
		console.log(req.headers);

		if(this.verifyClient && !this.verifyClient(info))
			return respond(resp, 401, 'not authorized');

		var key = this.guid();
		var socket = sockets[key] = new Socket(key, url.query);
		console.log("new socket", socket.key, socket.params);
		this.notify('connection', socket);
		return respond(resp, 200, { key:key });
	}

	this.handleRequest = function(req, resp) {
		var url = urllib.parse(req.url, true);
		if(url.pathname.indexOf(this.path)!=0)
			return false;

		if(url.pathname.length==this.path.length)
				return this.createSocket(req, url, resp);

		var key = url.pathname.substr(this.path.length+1);
		if(!key.length)
			return respond(resp, 400, 'socket id required');

		var socket = sockets[key];
		if(!socket)
			return respond(resp, 404, 'socket not found');

		var event = url.query.event;
		if(!event) {
			if(socket.request) {
				socket.request.resp.end();
				socket.request = null;
			}

			socket.setPresent(true);
			var rowid = url.query.rowid || socket.rowid;
			if(socket.journal.length>rowid) { // direct response:
				respond(resp, 200, socket.journal.slice(rowid));
				socket.expectReconnect(false);
				return;
			}
			// delay response:
			var request = socket.request = { resp:resp, timestamp:req.timestamp };
			var self = this;
			request.timeout = setTimeout(function() {
				if(!(key in sockets) || !socket.request)
					return;
				respond(resp, 204);
				socket.request = null;
				socket.expectReconnect(false);
			}, this.timeoutRequest);

			resp.on('close', function() {
				console.log('connection abort by client', request.timestamp);
				clearTimeout(request.timeout);
				socket.request = null;
				socket.setPresent(false);
			});
			return;
		}
		else if(event=='close')
			socket.close('client disconnected');
		else
			socket.notify(event, url.query.data);
		return respond(resp, 204);
	}
	this.on = function(event, callback) {
		if(typeof callback=='function')
			this.callbacks[event]=callback; 
		else if(!callback && this.callbacks[event])
			delete this.callbacks[event];
	}
	this.notify = function(event, payload) {
		var callback = this.callbacks[event];
		if(!callback)
			callback = this.callbacks['*'];
		if(!callback)
			return;
		callback(payload, event);
	}
}

module.exports = {
	createServer: function(path, verifyClient) {
		return new Server(path, verifyClient);
	}
}
