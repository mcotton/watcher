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
     username   =       require('./config').username || 'username',
     password   =       require('./config').password || 'password',
     realm      =       'eagleeyenetworks',
     host       =       'https://eagleeyenetworks.com';

var user        =       {},
    devices     =       {
                            cameras: [],
                            bridges: []
                        };

var debug = function(arg) {
    repl.start({
      prompt: "node via stdin> ",
      input: process.stdin,
      output: process.stdout
    }).context.arg = arg;
};



function startUp(success, failure) {
    out('**********************************');
    out('           Starting up            ');
    out('**********************************');
    if ( typeof success === 'function') success(); // call success callback
}

function login(success, failure) {
    r.post({
            url: host + '/g/aaa/authenticate',
            json: true,
            body: { 'username': username, 'password': password }
            }, function(err, res, body) {
                if (err) { out(err.stack); }
                if (!err) {
                    switch(res.statusCode) {
                        case 200:
                            r.post({ url: host + '/g/aaa/authorize', json: true, body: { token: res.body.token } }, function(err, res, body) {
                               if (err) { out(err.stack); }
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

function getDevices(success, failure) {
    r.get({url: host + '/g/list/devices', json: true }, function(err, res, body) {
        if (err) { out(err.stack) }
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

function startPolling() {
    var obj = { 'cameras': {} };

    u.each(u.filter(devices.bridges, function(item) { return item.deviceStatus === 'ATTD'; } ), function(item) {
        //obj.cameras[item.deviceID] = { "resource": [] };
    });

    u.each(u.filter(devices.cameras, function(item) { return item.deviceStatus === 'ATTD'; } ), function(item) {
        obj.cameras[item.deviceID] = { "resource": ["event"], "event": ["ROMS", "ROME"] };
    });

    out('**********************************');
    out('           Start Polling          ');
    out('**********************************');

    //console.log(obj)
    //console.log(JSON.stringify(obj))

    r.post({
            url:    host + '/poll',
            json:   true,
            body:   JSON.stringify( obj)
           }, function(err, res, body) {
                if (err) { out(err.stack) };
                if (!err) {
                    switch(res.statusCode) {
                        case 200:
                        case 503:
                            keepPolling();
                            break;
                         default:
                            out(res.statusCode);
                            out('**********************************');
                            out('           Restart Polling        ');
                            out('**********************************');
                            startPolling();
                            break;
                    }
                }

    });


}

function keepPolling() {
    //out('**********************************');
    //out('           Keep Polling           ');
    //out('**********************************');

    r.get({
            url:    host + '/poll',
            json:   true,
           }, function(err, res, body) {
                if (err) { out(err.stack) };
                if (!err) {
                    switch(res.statusCode) {
                        case 200:
                            // got a valid polling cookie
                            processPollingData(res.body);
                            keepPolling();
                            break;
                        case 400:
                            // got an invalid polling cookie
                            //debug({ 'res': res, 'socket': socket });
                            break;
                        default:
                            out(res.statusCode);
                            out('**********************************');
                            out('           Restart Polling        ');
                            out('**********************************');
                            startPolling();
                            break;
                    }
                }

    });

}

function processPollingData(data) {
    //out('**********************************');
    //out('           Processing Data        ');
    //out('**********************************');
    //console.dir(data.cameras['100b7d7c'].event.MRBX.boxes);
    if(data.cameras['100b7d7c'].event['ROMS']) {
        console.dir(data.cameras['100b7d7c'].event['ROMS']) 
        
        var image_url = 'https://login.eagleeyenetworks.com/asset/after/image.jpeg?c=100b7d7c;t=' + data.cameras['100b7d7c'].event['ROMS'].timestamp + ';a=all'
        r.get('http://apicon.azurewebsites.net/?url=' + image_url);
          out('http://apicon.azurewebsites.net/?url=' + image_url);
    }        
    //console.dir(data.cameras['100b7d7c']);
}


io.sockets.on('connection', function () {

/*
    startUp( function() {
        login( function() {
            getDevices(function() {
                startPolling(socket)
            });
        },
        // failure case for login
        function() {
            console.log('Failed to login using these credentials  ' + username + ' : ' + password );
        });
    });
*/
});

io.sockets.on('disconnect', function() {
});

route.get('/image/{device}/{ts}', function(orig_req, orig_res) {
    var ts      =   orig_req.params.ts,
        device  =   orig_req.params.device;

    //console.log('DEBUG: matching /image/' + device + '/' + ts);

    ts = (ts.indexOf('now') >= -1) ? 'now' : ts;

    var url = host + '/asset/prev/image.jpeg?c=' + device + ';t=' + ts + ';q=high;a=pre';

    try {
        r.get(url).pipe(orig_res)
    } catch(e) {
        out('error in fetching images: ', e)
    }

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

route.get('/page.html', function(req, res) {
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



startUp( function() {
    login( function() {
        getDevices(function() {
            startPolling()
        });
    },
    // failure case for login
    function() {
        console.log('Failed to login using these credentials  ' + username + ' : ' + password );
    });
});
