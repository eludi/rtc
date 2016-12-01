function EventSocketWS(websocket, params) {
	this.params = params;
	this.callbacks = {};
	this.ws = websocket;
	this.key = (function() {
		var s4 = function() {
			return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
		}
		return s4() + s4() + s4() + s4() + s4() + s4() + s4() + s4();
	})();
		
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
		this.notify('close', {code:code, reason:reason});
	}

	var self = this;
	websocket.on('message', function(msg) {
		console.log('ws', self.params.name+'@'+self.params.channel,'>>', msg);
		msg = JSON.parse(msg);
		self.notify(msg.event, msg.data);
	});
	websocket.on('close', function(code, reason) {
		console.log('ws close', code, reason);
		self.notify('close', { code:(code===undefined) ? 1000 : code, reason: reason ? reason : '' });
	});
}

module.exports = EventSocketWS;
