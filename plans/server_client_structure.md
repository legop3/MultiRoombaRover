# server code structure:
The server's internal structure will be modular, and by modular i mean completely modular,
the modules will import what they need from other modules, and export what other modules will need from them.
the entrypoint file will contain nothing but a long list of `require('')`s for all of the modules in the proper order

for example, A service which automatically assigns a newly connected user to a roomba that isn't in use.
this service would import the roomba list from whatever other service contains it, and import the global socket.io server instance. It will add its own io.on('connection') to the socket.io instance, which contains the logic for assigning users to roombas. 

- modular code structure
  - one folder for each of these categories
    - globals
      - GLOBALS ARE: "static" parts of the server that don't contain any interactive logic.
      - where the express, websocket, and socket.io instances will be
      - other global things
    - services
      - SERVICES ARE: parts of the program that are part of the interaction pipeline.
      - contains things like the roomba manager
      - will also in the future contain other things like a discord bot, home assistant integration, etc
      - anything with a large amount of controlling logic should be in here
    - helpers
      - HELPERS ARE: parts of the program that other modules only pull helper funcions or classes from.
        - if a function or class is dedicated to a service, it should NOT be in a helper.
      - contains passive helpers
      - things like the logger system
      - no "service" logic in here, only things that are passively pulled out and used inside other modules
- one entrypoint file that contains NOTHING but `require('')`s.



# server <-> web client logistics

I want each connected roomba to have a list of drivers. if a socket is not in this list, they are not allowed to drive the roomba. I will be adding admins, authentication, a turns system, and automatic roomba assignment later so it is important that we start with this system in place.
a roomba's list of drivers will be completely managed by the server, users should not be able to change driver lists, even in a hacky way.

Each user will also have to see sensor data from the roomba that they are controlling. I want it to be done in this way:
- for each connected roomba, there is a socket.io room where all of the sensor data is streamed out to clients
- the client will be added to the room, where they can see all of the active roomba's sensor data
- ALSO for future use, it needs to work properly if a socket is subscribed to all rooms, in the future there will be a spectator page which can view all of the roombas at once. 

I want there to be a ground up system where I can set the entire service to four different modes:
- open (anyone can drive, roombas are assigned randomly. if they are all full, two people will be controlling the same roomba)
- turns (anyone can drive, roombas are assigned randomly. if they are all full, each person gets one minute on their selected roomba)
- admin (only authenticated admins can log in, anyone can still view but no one is allowed to drive but admins)
- lockdown (only "lockdown" admins can view or drive. no one else can view, not even spectators).
only admins can change modes.

do NOT implement any authentication stuff yet, just add a stub service with places set up to put the auth. logic

# web client code structure:
- the same as the server's code structure
  - all ES6