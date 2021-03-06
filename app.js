var r           =       require('request'),
    u           =       require('underscore')._,
    router      =       require('router'),
    repl        =       require('repl');

var route       =       router();

var app         =       require('http').createServer(route),
    io          =       require('socket.io').listen(app, { log: false }),
    fs          =       require('fs');

    app.listen(3000);


var  out        =       console.log,
     config     =       require('./config'),
     host       =       'https://login.eagleeyenetworks.com';

var user        =       {},
    devices     =       {
                            cameras: [],
                            bridges: []
                        },
    last_img    =       {};
    cached_img  =       {};


var debug = function(arg) {
    repl.start({
      prompt: "node via stdin> ",
      input: process.stdin,
      output: process.stdout
    }).context.arg = arg;
};

var cookie_jars = {}

function startUp(socket, success, failure) {
    out('**********************************');
    out('           Starting up            ');
    out('**********************************');
    if ( typeof success === 'function') success(); // call success callback   
}

function login(socket, success, failure) {
    r.get({
            url: host + '/g/aaa/isauth',
            jar: cookie_jars[socket.id]
        }, function(err, res, body) {
            if (err) { 
                out("error in pre-login");
                out(err.stack);
                if ( typeof failure === 'function') failure(); 
            }
            if (!err) {
                switch(res.statusCode) {
                    case 200:
                        out('*********** Auth is still good ***************');
                        if ( typeof success === 'function') success();
                        break;
                    default:
                        r.post({
                            url: host + '/g/aaa/authenticate',
                            json: true,
                            body: { 'username': config.username, 'password': config.password, 'realm': 'eagleeyenetworks' }
                            }, function(err, res, body) {
                                if (err) { out("error in login1"); out(err.stack); }
                                if (!err) {
                                    switch(res.statusCode) {
                                        case 200:
                                            r.post({ url: host + '/g/aaa/authorize',
                                                    jar: cookie_jars[socket.id],
                                                    json: true, body: { token: res.body.token }
                                                }, function(err, res, body) {
                                               if (err) { out("error in login2"); out(err.stack); }
                                               if (!err && res.statusCode == 200) {
                                                    out('**********************************');
                                                    out('           Logged in              ');
                                                    out('**********************************');
                                                    user = res.body;
                                                    if ( typeof success === 'function') success(); // call success callback
                                                }
                                            })
                                            break;
                                        default:
                                            out(res.statusCode + ': ' +  res.body);
                                            if ( typeof failure === 'function') failure(); // call failure callback

                                    }
                                }
                    })

                }

            }
    })
}

function getDevices(socket, success, failure) {
    r.get({ url: host + '/g/list/devices',
            json: true,
            jar: cookie_jars[socket.id]
        }, function(err, res, body) {
        if (err) { out("error in getDevices"); out(err.stack) }
        if (!err && res.statusCode == 200) {
            out('**********************************');
            out('           Grabbed Devices        ');
            out('**********************************');

            u.each(res.body, function(device) {
                var tmp = {};
                if(device[3] === 'camera') {
                    tmp = {
                        deviceID:           device[1] || '',
                        deviceStatus:       device[5] || ''
                    };
                    devices.cameras.push(tmp);
                } else {
                    tmp = {
                        deviceID:           device[1] || '',
                        deviceStatus:       device[5] || ''
                    };
                    devices.bridges.push(tmp);
                }
            });

            if ( typeof success === 'function') success(); // call success callback
        }
    });
}

function startPolling(socket) {
    var obj = { 'cameras': {} };

    // u.each(u.filter(devices.bridges, function(item) { return item.deviceStatus === 'ATTD'; } ), function(item) {
    //     obj.cameras[item.deviceID] = { "resource": [] };
    // });

    var cameras_to_poll = devices.cameras

    if(config.filter_cameras.length > 0) {
        cameras_to_poll = u.filter(devices.cameras, function(item) { return config.filter_cameras.indexOf(item.deviceID) > -1 })
    }

    u.each(u.filter(cameras_to_poll, function(item) { return item.deviceStatus === 'ATTD' } ), function(item) {
        obj.cameras[item.deviceID] = { "resource": ["pre"] };
    });

    out('**********************************');
    out('           Start Polling          ');
    out('**********************************');

    r.post({
            url:    host + '/poll',
            jar: cookie_jars[socket.id],
            json:   true,
            body:   JSON.stringify( obj)
           }, function(err, res, body) {
                if (err) { out("error in startPolling"); out(err.stack); startPolling(socket) };
                if (!err) {
                    switch(res.statusCode) {
                        case 200:
                            keepPolling(socket);
                            break;
                        case 500:
                            out(res.statusCode + ' in keepPolling()');
                            out(res.headers);
                            out(res.body);
                            startPolling(socket);
                            break;
                        case 502:
                        case 503:
                            out(res.statusCode + ' in keepPolling()');
                            out(res.headers);
                            out(res.body);
                            keepPolling(socket);
                            break;
                        case 401:
                            handle_401(socket);
                            break;
                         default:
                            out(res.statusCode);
                            out(res.headers);
                            out(res.body);
                            out('**********************************');
                            out('           Restart Polling        ');
                            out('**********************************');
                            startPolling(socket);
                            break;
                    }
                }

    });


}

function keepPolling(socket) {
    //out('**********************************');
    //out('           Keep Polling           ');
    //out('**********************************');

    r.get({
            url:    host + '/poll',
            jar: cookie_jars[socket.id],
            json:   true,
           }, function(err, res, body) {
                if (err) { out("error in keepPolling"); out(err.stack); keepPolling(socket);};
                if (!err) {
                    switch(res.statusCode) {
                        case 200:
                            // got a valid polling cookie
                            processPollingData(socket, res.body);
                            keepPolling(socket);
                            break;
                        case 400:
                            out(res.statusCode + ' in keepPolling');
                            out(res.headers);
                            out(res.body);
                            out('**********************************');
                            out('           Restart Polling        ');
                            out('**********************************');
                            startPolling(socket);
                            break;
                        case 401:
                            handle_401(socket);
                            break;
                        case 500:
                            out(res.statusCode + ' in keepPolling()');
                            out(res.headers);
                            out(res.body);
                            startPolling(socket);
                            break;
                        case 502:
                        case 503:
                            out(res.statusCode + ' in keepPolling()');
                            out(res.headers);
                            out(res.body);
                            keepPolling(socket);
                            break;
                        default:
                            out(res.statusCode + ' in keepPolling()');
                            out(res.headers);
                            out(res.body);
                            out('**********************************');
                            out('           Restart Polling        ');
                            out('**********************************');
                            startPolling(socket);
                            break;
                    }
                }

    });

}

function processPollingData(socket, data) {
    //out('**********************************');
    //out('           Processing Data        ');
    //out('**********************************');
    //out(data);
    if(socket) {
        socket.emit('poll', { data: data });
    }
}

function handle_401(socket) {
    out("Got a 401, going to start the bootstrap process over again")
    bootstrap(socket);
}


function bootstrap(socket) {
    // tell the client what their id is
    socket.send(socket.id);
    out('Client\'s socket id is: ' + socket.id);

    startUp( socket, function() {
        login( socket, function() {
            getDevices(socket, function() {
                startPolling(socket)
            },
            function() {
                console.log('Failure case for getDevices()');
            });
        },
        // failure case for login
        function() {
            console.log('Failed to login using these credentials  ' + username + ' : ' + password );
        });
    });
}


app.on('error', function(e) {
    console.log(e)
});

io.sockets.on('connection', function (socket) {
    var _socket = socket

    if(!(socket.id in cookie_jars)) {
        cookie_jars[socket.id] = r.jar();
    }

    bootstrap(_socket);
});

io.sockets.on('disconnect', function(socket) {
    out('socket disconnected', socket);
});

route.get('/image/{device}/{ts}', function(orig_req, orig_res) {
    var ts      =   orig_req.params.ts,
        device  =   orig_req.params.device;
        socket_id = orig_req.params.socket_id;

    //console.log('DEBUG: matching /image/' + device + '/' + ts);

    // ts = (ts.indexOf('now') >= -1) ? 'now' : ts;

    var url = host + '/asset/prev/image.jpeg?c=' + device + ';t=' + ts + ';q=high;a=pre';

    socket_id = orig_req.url.match(/socket_id=(\S*)(\&*)/)[1]

    if (!(device in last_img)) {
        last_img[device] = "0"
    }


   // if(ts <= last_img[device]) {
        // requested image is older
        // send them the cached image
        if(ts <= last_img[device]) {
            orig_res.headers = {"content-type": "image/jpeg"};
            orig_res.write(cached_img[device]);
            orig_res.end();
            out("Served image from cache!");
            return;
        } else {
            out("fetching a new image for " + device);
            last_img[device] = ts;
        }

    //} else {

        var url = host + '/asset/prev/image.jpeg?c=' + device + ';t=' + ts + ';q=high;a=pre';

        try {
            r.get({ url: url,
                    jar: cookie_jars[socket_id],
                    encoding: null
                }, function(err, res, body) {
                    if (err) { out("error in GET /image/" + device + "/" + ts); out(err.stack);};
                    if(!err && res.statusCode == 200) {                       
                        cached_img[device] = new Buffer.alloc(parseInt(res.headers['content-length'], 10), body, 'base64');
                        orig_res.headers = {"content-type": "image/jpeg"};
                        orig_res.write(cached_img[device]);
                        orig_res.end();
                    }
                    
                })
            //.pipe(orig_res);

        } catch(e) {
            out('error in fetching images: ', e)
        }

   // }

});


route.get('/jquery.preview.js', function(req, res) {
  fs.readFile(__dirname + '/jquery.preview.js',
  function (err, data) {
    if (err) {
      res.writeHead(500);
      return res.end('Error loading /jquery.preview.js');
    }

    res.writeHead(200);
    res.end(data);

    out('serving /jquery.preview.js');

  });
});

route.get('/:device', function(req, res) {
  fs.readFile(__dirname + '/page.html',
  function (err, data) {
    if (err) {
      res.writeHead(500);
      return res.end('Error loading page.html');
    }

    res.writeHead(200);
    res.end(data);

    out('serving /page.html');

  });
});

route.get('*', function(req, res) {
  fs.readFile(__dirname + '/index.html',
  function (err, data) {
    if (err) {
      res.writeHead(500);
      return res.end('Error loading index.html');
    }

    res.writeHead(200);
    res.end(data);

    out('serving /index.html');

  });
});



process.on('uncaughtException', function(err) {
  console.log('Caught exception: ' + err);
  switch(err) {
    case 'Error: Parse Error':
        out(err);
        break;
  }
});

process.on('SIGTERM', function () {
  server.close(function () {
    process.exit(0);
  });
});


