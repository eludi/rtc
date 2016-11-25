// a websocket that is capable of transferring structured events
function EventSocket(url, params) {
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
			this.socket.close(code ? code : 1000, reason);
	}
	this.on = function(event, callback) {
		if(typeof callback=='function')
			this.callbacks[event]=callback;
		else if(!callback)
			delete this.callbacks[event];
	}

	this._notify = function(event, data) {
		if(event in this.callbacks)
			return this.callbacks[event](data, event);
		if('*' in this.callbacks)
			return this.callbacks['*'](data, event);
		return false;
	}
	var encodeURI = function(obj) {
		var s = '';
		if(typeof obj == 'object') for(var key in obj) {
			s += s.length ? '&' : '?';
			var value = obj[key];
			if(typeof value == 'object')
				value = JSON.stringify(value);
			s += key+'='+encodeURIComponent(value);
		}
		return s;
	}

	this.callbacks = { };
	this.status = 'connecting';

	var self = this;
	var socket = this.socket = new WebSocket(url+encodeURI(params));
	socket.onmessage = function(msg) {
		var data = JSON.parse(msg.data);
		self._notify(data.event, data.data);
	}
	socket.onopen = function(evt) {
		self.status = 'open';
		self._notify(self.status);
	}
	socket.onclose = function(evt) {
		self.status = (self.status=='connecting') ?'failed': evt.wasClean ? 'closed' : 'error';
		var data = { code:evt.code, status:self.status };
		if(evt.reason.length)
			data.reason = evt.reason;
		self._notify('close', data);
		delete self.socket;
		self.socket = null;
	}
}
