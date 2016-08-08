
function CometSocket(url, params) {

	var httpRequest = function(url, params, callback) {
		var encodeURI = function(obj) {
			var s = '';
			for(var key in obj) {
				if(s.length) s += '&';
				var value = obj[key];
				if(typeof value == 'object')
					value = JSON.stringify(value);
				s += key+'='+encodeURIComponent(value);
			}
			return s;
		}
		var paramStr = encodeURI(params);
		if(params)
			url+='?'+paramStr;

		var xhr = new XMLHttpRequest();
		try {
			xhr.open( 'GET', url, true );
			if(callback) xhr.onload = xhr.onerror = function(event) {
				var status = (xhr.status===undefined) ? -1 : (xhr.status==1223) ? 204 : xhr.status;
				var response = (xhr.status==-1 || xhr.status==204) ? null
					: (xhr.contentType=='application/json' || (('getResponseHeader' in xhr) && xhr.getResponseHeader('Content-Type')=='application/json'))
					? JSON.parse(xhr.responseText) : xhr.responseText;
				callback( response, status );
			}
			xhr.send( null );
		} catch(error) {
			window.console && console.error(error);
			return false;
		}
		return xhr;
	}

	this.emit = function(event, data) {
		if(this.readyState != 1)
			return;
		if(typeof data=='object')
			data = JSON.stringify(data);
		var params = { event:event, data:data };
		var self = this;
		httpRequest(this.url, params, function(value, status){ self._callback(value, status) });
	}
	this.close = function(code, reason) {
		if(this.readyState != 1)
			return;
		var data = { code:(code===undefined) ? 1000 : code, reason: reason ? reason : '' };
		this.emit('close', data);

		this.readyState = 2;
		this.status = 'closing';
		if(this.pollRequest) {
			this.pollRequest.abort();
			this.pollRequest = null;
		}
		this.notify('close', data);
		if(this.timeoutId)
			clearTimeout(this.timeoutId);
		this.readyState = 3;
		this.status = 'closed';
	}
	this.on = function(event, callback) {
		if(typeof callback=='function')
			this.callbacks[event]=callback; 
		else if(!callback)
			this.callbacks[event]=null;
	}
	this.notify = function(event, data) {
		if(event in this.callbacks)
			return this.callbacks[event](data);
		if('*' in this.callbacks)
			return this.callbacks['*'](data, event);
		return false;
	}

	this._callback = function(value, status) {
		if(this.readyState>1)
			return;
		if(status==200) { // ok
			var input;
			if (typeof value =='string')
				input = (value && value.length) ? JSON.parse(value) : [];
			else input = value;
			for(var i=0; i<input.length; ++i) {
				var msg = input[i];
				this.notify(msg.event, msg.data);
			}
			this.rowid += input.length;
		}
		else if(status==204) // ok, no response
			return;
		else if(status<=0 || status>=300) {
			this._error(status, status ? value.error : 'connection lost');
		}
		else console && console.error('unrecognized response code', status, value);
	}
	this._cbPoll = function(value, status) {
		if(this.timeoutId) {
			clearTimeout(this.timeoutId);
			this.timeoutId = 0;
		}
		this.pollRequest = null;
		this._callback(value, status);
		if(this.readyState==1) {
			var self = this;
			setTimeout(function() { self.poll(); }, 0);
		}
	}
	this.poll = function() {
		if(this.readyState<1 || this.readyState==3)
			return;
		var self = this;
		var xhr = this.pollRequest = httpRequest(this.url, { rowid:this.rowid }, function(value,status) { self._cbPoll(value,status); });
		if(this.timeoutId)
			clearTimeout(this.timeoutId);
		this.timeoutId = setTimeout(function() { self._cbTimeout(xhr); }, this.timeout);
	}
	this._cbTimeout = function(xhr) {
		if(typeof xhr == 'object')
			xhr.abort();
		this.pollRequest = null;
		if(this.readyState<0 || this.readyState>1)
			return;
		this._error(118, "connection timeout");
	}
	this._cbOpen = function(resp, status) {
		if(this.readyState!=0)
			return;
		if(this.timeoutId) {
			clearTimeout(this.timeoutId);
			this.timeoutId = 0;
		}
		if(status==200) {
			this.readyState = 1;
			this.status = 'open';
			var data = (status==204) ? null : (typeof resp =='string' && resp.length) ? JSON.parse(resp) : resp;
			var key = data.key;
			this.url += '/' + data.key;
			window.console && console.log('socket key obtained:', key);
			this.notify('open', data);
			this.poll();
		}
		if(!this.readyState)
			this._error(status, resp.error );
	}
	this._error = function(code, error) {
		this.notify('error', { code:status, error:error });
		this.status = 'error';
		this.close(1006, 'error '+code+' '+error);
	}
	//--- constructor ---
	this.url = null;
	this.channel = channel
	this.rowid=0;
	this.readyState = 0; // 0 == CONNECTING, 1 == OPEN, 2 == CLOSING, 3 == CLOSED
	this.status = 'connecting';
	this.callbacks = { };
	this.pollRequest = null;
	this.timeout = 30*1000;
	this.url = url;

	var self = this;
	var xhr = httpRequest(this.url, params, function(resp, status) { self._cbOpen(resp, status) });
	this.timeoutId = setTimeout(function() { self._cbTimeout(xhr); }, this.timeout);
}
