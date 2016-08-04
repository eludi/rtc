// a websocket that is capable of transferring structured events
function EventSocket(url) {
	this.emit = function(event, data) {
		if(!event || !this.socket||this.socket.readyState!=1)
			return false;
		var msg = { event:event };
		if(data!==undefined)
			msg.data = data;
		msg = JSON.stringify(msg);
		this.socket.send(msg);
		return true;
	}
	this.close = function(code, reason) {
		if(this.socket)
			this.socket.close(code, reason);
	}
	this.on = function(event, callback) {
		if(typeof callback=='function')
			this.callbacks[event]=callback; 
		else if(!callback)
			this.callbacks[event]=null;
	}
	var self = this;
	var notify = function(event, data) {
		if(event in self.callbacks)
			return self.callbacks[event](data, event);
		if('*' in self.callbacks)
			self.callbacks['*'](data, event);
	}

	this.callbacks = { };
	this.status = 'connecting';

	var socket = this.socket = new WebSocket(url);
	socket.onmessage = function(msg) {
		var data = JSON.parse(msg.data);
		notify(data.event, data.data);
	}
	socket.onopen = function(evt) {
		self.status = 'open';
		notify(self.status);
	}
	socket.onclose = function(evt) {
		self.status = (self.status=='connecting') ?'failed': evt.wasClean ? 'closed' : 'error';
		var data = { code:evt.code, status:self.status };
		if(evt.reason.length)
			data.reason = evt.reason;
		notify('close', data);
		delete self.socket;
		self.socket = null;
	}
}
