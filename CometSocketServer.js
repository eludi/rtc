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
			evt.data= (typeof data=='object') ? JSON.stringify(data) : data;

		this.journal.push(evt);
		if(this.request) {
			respond(this.request.resp, 200, [evt]);
			clearTimeout(this.request.timeout);
			this.request = null;
			this.expectReconnect(timeoutPresence);
		}
	}
	this.close = function(reason) {
		if(this.readyState != 1)
			return;
		var data = reason ? { reason:reason } : null;
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
		this.notify('present', isPresent);
	}
	this.expectReconnect = function(deltaT) {
		if(this.timeout)
			clearTimeout(this.timeout);
		var socket = this;
		this.timeout = setTimeout(function() {
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

	this.createSocket = function(req, resp) {
		if(this.verifyClient && !this.verifyClient({ req: req }))
			return respond(resp, 401);

		var key = this.guid();
		var socket = sockets[key] = new Socket(key, req.params);
		console.log("new socket", socket.key, socket.params);
		this.notify('connection', socket);
		return respond(resp, 200, { key:key });
	}

	this.handleRequest = function(req, resp) {
		if(!req.path.length || req.path[0]!=this.path)
			return false;
		if(req.path.length==1 && req.method=='POST')
			return this.createSocket(req, resp);

		if(req.path.length<2)
			return respond(resp, 400, 'socket id required');

		var key = req.path[1];
		var socket = sockets[key];
		if(!socket)
			return respond(resp, 404, 'socket not found');

		switch(req.method) {
		case 'GET': {
			if(socket.request) {
				socket.request.resp.end();
				socket.request = null;
			}

			socket.setPresent(true);
			var rowid = req.params.rowid || socket.rowid;
			if(socket.journal.length>rowid) { // direct response:
				respond(resp, 200, socket.journal.slice(rowid));
				socket.expectReconnect(timeoutPresence);
				return;
			}
			// initiate long polling:
			var request = socket.request = { resp:resp, ip:req.ip, timestamp:req.timestamp };
			var self = this;
			request.timeout = setTimeout(function() {
				if(!(key in sockets) || !socket.request)
					return;
				respond(resp, 204);
				socket.request = null;
				socket.expectReconnect(timeoutPresence);
			}, this.timeoutRequest);

			resp.on('close', function() {
				console.log('connection abort by client', request.ip, request.timestamp);
				clearTimeout(request.timeout);
				socket.request = null;
				socket.setPresent(false);
			});
			break;
		}
		case 'POST': {
			var event = req.params.event;
			if(!event)
				return respond(resp, 400, 'event required');
			if(event=='close')
				socket.close('client disconnected');
			else
				socket.notify(event, req.params.data);
			return respond(resp, 204);
		}
		default:
			return respond(resp, 405, 'method not allowed');
		}
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
