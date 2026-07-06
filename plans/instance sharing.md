# the inter-instance API and system
A single API endpoint that returns one json object with information about this instance of this server, meant to display on other servers.
A centralized json file pulled from a simple link on the internet which contains a list of public server instances
Basically, designed so that everyone's rover servers can show on everyone else's rover servers in some way.
In the end once its all working, users will be able to see rovers from other instances on any other instance, click on a rover, and just via a simple href with a few URL params, it will put you on that instance, that rover, and transfer your cookie object through a URL parameter.

## centralized json file of public instances
- contains a list of simple URLs, like:
```["https://rover.otter.land"], ["http://14.84.27.47:8080]```
- all servers will use the same link to the same json file by default (this will be to a file on github or something)
- there is an option for multiple links, for redundancy. but it only comes with one in the config.
- this should be ONLY a list of links, maybe with placeholder names to show in the UI if one of them is offline
- if my server had the two example links above, it would contact both info API endpoints from both of those separate instances for information about them.
- if a new server is to be added, add it to the centralized json file and that instance will show on all other instances, and it will show all other instances on itself.

## the general concept of the inter-instance API system
- every server hosts the same API endpoint which returns one big json object for that instance
- every server automatically gets the list of instances from the centralized json file
- every server automatically requests all of the other inter-instance information from all the other servers
- every server will show the info from all the other servers on it's web UI.

## what information will the servers get from the other servers?
- servers will get a bunch of info from the other servers which they poll the APIs of
- this information will, for the most part, just be sent straight to the web UI where most of the data moving will happen
- at least these things will need to be communicated
  - is the server open? (turns/open access mode)
  - server name
  - server color for UI
  - non-optional description
  - an object of rovers containing, for each rover,
    - rover name
    - rover battery level
    - any users on it?
    - rover color
    - rover description
    - locked?
    - locked reason
    - basically, all the info that the webui uses now to show a rover in the rover roster
  - maybe an object containing feature states, from the system of features.js in the server, so people can see what features that instance does and doesn't have
  - MAYBE could even have images that are derived from that instance's URL that the web UI can use to show room cameras if they exist or rover snapshots

## what will this look like in the web UI?
- a button at the bottom of the rover roster that says show external rovers or something
  - when you hit this button it shows the external rovers in the same roster stuff as the local instance rovres
  - when this is expanded theres a button to open the shared inter-instance component in a popup
- a new component, a cardframe, which will be a component shared in multiple spots. contains:
  - the instances
    - the instance info, name, description, etc
    - the rovers in the instances and their statuses
    - the features that the instance has
- ALSO show this same cardframe on the admin lock overlay, so people can see other instances while their current one is locked
- all new UI has to be mobile friendly.


## switching to a different instance from a previous one
- users should be able to click on a rover from the listing of another instance, and be put on that rover on that instance.
  - this should just be a thing that takes you to a new link to the new instance, with a couple of URL params.
- when switching, have a URL param for the rover that theyre requesting, 
  - this URL param should just make the web UI automatically request the rover from the param.
- and another URL param, which:
  - takes their ENTIRE identity / settings cookie over to the new instance, by encoding the json in base64 in the URL. 
    - when the web UI takes this URL in, it should replace the cookie with the one from the URL. maybe with a popup first that asks to transfer your identity from previous instance to the new one?