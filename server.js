// database - https://github.com/louischatriot/nedb

var Datastore = require('nedb')
, dbLayers = new Datastore({ filename: 'layers.db', autoload: true });

dbLayers.persistence.setAutocompactionInterval(300 * 1000);

var Joukkue = {
  msg: {
    serverName:    'cpu',
    someoneIsHere: '%s is here',
    roomInfo:      'Hi %s!\nYou are in the %s room %s'
  },
  fmt: function(msg, etc) {
    var i = 1;
    var args = arguments;
    return msg.replace(/%((%)|s)/g, function (m) { return m[2] || args[i++] })
  }
};

// web server

var app = require('express')();

app.get('/', function(req, res) {
    res.sendFile(__dirname + '/index.html');
});

app.get('/grid.html', function(req, res) {
    res.sendFile(__dirname + '/grid.html');
});

app.get('/*.(js|css|png)', function(req, res) {
    res.sendFile(__dirname + "/public" + req.url);
});

var server = app.listen(3000, function () {
  var host = server.address().address
  var port = server.address().port
  console.log('Joukkue listening at http://%s:%s', host, port)
});

// socket.io

var io = require('socket.io').listen(server);

io.on('connection', function(socket) {
  function getUsersInRoom(user, room) {
    var names = [];
    var clients = io.sockets.adapter.rooms[room];
    for (var name in clients ) {
      var c = io.sockets.connected[name];
      if(user != c.username) {
        names.push(c.username);
      }
    }
    if(names.length > 0) {
      return "with " + names.join(", ");
    } else {
      return "by yourself"
    }
  }

  function sendLayersToUser() {
    var layers = {};
    dbLayers.find({ room: socket.room }, function(err, layerData) {
      if (layerData.length > 0) {
        for(var i in layerData) {
          var n = layerData[i].name;
          layers[n] = {
            name: n,
            vars: layerData[i].vars,
            draw: layerData[i].draw,
            depth: layerData[i].depth
          };
        }
      }
      socket.emit('allLayers', layers);
    });
  }
  function sendRoomInfo() {
    socket.emit('say', Joukkue.msg.serverName, Joukkue.fmt(
      Joukkue.msg.roomInfo,
      socket.username,
      socket.room,
      getUsersInRoom(socket.username, socket.room)
    ));
  }

  socket.on('requestRoomInfo', function() {
    sendRoomInfo();
  });

  socket.on('addUser', function(username) {
    socket.username = username;
    socket.room = 'default';
    socket.join(socket.room);
    sendLayersToUser();
    // to you
    sendRoomInfo();
    // to room
    socket.to(socket.room).emit('say', Joukkue.msg.serverName, Joukkue.fmt(Joukkue.msg.someoneIsHere, socket.username));
  });


	socket.on('joinRoom', function(newroom){
    // to you
		socket.emit('say', Joukkue.msg.serverName,
                'You are now in the ' + newroom + ' room '
                + getUsersInRoom(socket.username, newroom) + '.\n');

    // to old room
		socket.broadcast.to(socket.room).emit('say', Joukkue.msg.serverName, socket.username + ' went to room ' + newroom);

    // to new room
		socket.broadcast.to(newroom).emit('say', Joukkue.msg.serverName, socket.username + ' is here');

		socket.leave(socket.room);
		socket.join(newroom);
		socket.room = newroom;
    sendLayersToUser();
	});

  socket.on('say', function(msg) {
    io.to(socket.room).emit('say', socket.username, msg);
  });

  socket.on('vars', function(name, vars) {
    dbLayers.update(
      { room: socket.room, name: name },
      { $set: { room: socket.room, name: name, vars: vars } },
      { upsert: true },
      function(err, numReplaced, newDoc) {
        io.to(socket.room).emit('vars', name, vars);
      }
    );
  });

  socket.on('draw', function(name, func) {
    dbLayers.update(
      { room:socket.room, name: name },
      { $set: { room: socket.room, name: name, draw: func } },
      { upsert: true },
      function(err, numReplaced, newDoc) {
        io.to(socket.room).emit('draw', name, func);
      }
    );
  });

  socket.on('remove', function(name) {
    dbLayers.remove(
      { room:socket.room, name: name },
      { },
      function(err, numRemoved) {
        io.to(socket.room).emit('remove', name);
      }
    );
  });

  socket.on('depth', function(name, dep) {
    dbLayers.update(
      { room:socket.room },
      { $set: { room: socket.room, name: name, depth: dep  } },
      { upsert: true },
      function(err, numReplaced, newDoc) {
        io.to(socket.room).emit('depth', name, dep);
      }
    );
  });

  socket.on('disconnect', function() {
    socket.to(socket.room).emit('say', 'SERVER', socket.username + ' is gone');
  });

});

