# general idea:
- control on / off switches and lights in home assistant from the web UI
- use this:
  - https://www.npmjs.com/package/home-assistant-js-websocket/v/3.1.2
  - remember to ignore updates that are of the same states, this library will give you a lot of those
- switches and lights are configured in the server's config file
  - give each one a name (no description)
  - auto detect a switch type or light type
- deliver list of lights to the UI through the session service
- show realtime on/off status of the switches / lights in the UI
- create a react component for the controls
  - it will automatically create a control for each switch / light

## permissions:
- even if someone isnt assigned to a rover, they should be able to control the switches / lights