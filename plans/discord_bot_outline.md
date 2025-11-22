# general idea
- discord bot run by the server
- use discord.js
- don't use discord's slash commands
  - listen for commands the old fashioned way
  - only admins with IDs set in the server config can use commands
- use nice looking embeds with colors for everything but messages

# features

## admin server management commands
- admins can lock and unlock rovers from discord
- admins can change the server access control mode

## announcements
- the bot has an announcements channel assigned in the server config. It will also have an announcement role ID to optionally ping. it will announce:
  - when a rover is locked / unlocked (no ping)
  - when the server access mode is changed (ping)
- the bot will have an admin ping role and alert channel. in here will be:
  - rover activity (no pings)
    - docking
    - charging
    - stopping charging
    - undocking
  - rover alerts (ping)
    - rover comes online
    - rover goes offline
    - rover is at warn battery
    - rover is at urgent battery

## chat bridge
- bridge between the server chat and discord chat
- use chat events that are on the bus already


