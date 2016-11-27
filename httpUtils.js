var http = require('http');
var urllib = require('url');
var qs = require('querystring');
var fs = require('fs');

function respond(resp, code, body) {
	var delayedResponse = 1500; // delay impeding denial of service / brute force attacks
	var headers = { 'Cache-Control': 'no-cache, no-store, must-revalidate, proxy-revalidate', 'Pragma':'no-cache',
		'Access-Control-Allow-Origin':'*' };
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

function createServer(ip, port, requestHandler, redirectHandler) {
	var isOpenshift = process.env.OPENSHIFT_NODEJS_IP!=null;
	var httpServer = http.createServer(function(req, resp) {
		// parse request:
		var params = {};
		var handle = function() {
			var url = urllib.parse(req.url, true);
			if(req.method!='POST')
				params = url.query;
			var protocol = (isOpenshift && req.headers['x-forwarded-proto']=='https')
					? 'https' : url.protocol ? url.protocol.substr(0, url.protocol.length-1) : 'http';

			if(redirectHandler) {
				redirect = redirectHandler(req, protocol, url);
				if(redirect) {
					console.log(req.url,'->', redirect);
					resp.writeHead(301, { 'Location': redirect });
					return resp.end();
				}
			}

			if(params.data && typeof params.data == 'string'
				&& (params.data[0]=='{' || params.data[0]=='[' || params.data[0]=='"' ))
				params.data = JSON.parse(params.data);

			var path = url.pathname.substr(1).split('/');
			if(path.length && path[path.length-1]=='')
				path.pop();
			var request = {
				method:req.method,
				path:path,
				params: params,
				protocol: protocol,
				remoteAddress:('x-forwarded-for' in req.headers) ? req.headers['x-forwarded-for'] : req.connection.remoteAddress,
				timestamp: new Date().getTime()
			};
			console.log(JSON.stringify(request));
			return requestHandler(req, resp, req.method, path, params, request.remoteAddress);
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
	httpServer.listen(port, ip);
	console.log('Server listening at', ip, port);
	return httpServer;
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

module.exports = {
	respond: respond,
	serveStatic: serveStatic,
	createServer: createServer,
	parseArgs: parseArgs,
}
