# REFACTOR RULES
- do NOT change ANY functionality!!! all changes should be purely internal!!
- this refactor is for simplification purposes, to make it easier to work on. remove any unused files and code.

## server backend
- there are a lot of services and some have gotten huge, like way too large to manage manually
- all services should be converted into folders, with their files inside the folders
- large functions of the service should be split off into more, smaller files within the service's folder
- keep files relatively small and very clear and concise in their function. with titles commented at the top.

## webui frontend
- similar situation to the server's service file bloat, but with large jsx component files
- split up large jsx components and backing js files into folders containing smaller files
- use same clear concise functional format, with title comments
- the web UI probably has a lot of leftovers inside still, old files that arent used, backwards compatability that doesnt need to exist, etc. simplify it all.


# REFACTOR TRACKING
## server backend
### BIGGEST OFFENDERS
- audio forward service
- button box service
- chat service
- discord bot service
- home assistant service
- llm commentary service
- private rover access request service
- replay services, already split up kinda. still go through them and reformat into folders.
- room camera services, also split up already. go through and reformat
- rover manager service
- session service
- turn service
- verification service
- video auth service
- despite this list, ALL SERVICES should be reorganized into folders and split up where reasonable

### COMPLETED SERVICES
- 

### LARGE CHANGES
- 








## webui frontend
### BIGGEST OFFENDERS
- mini summary app
- spectator app
- vip audio upload card
- admin panel
- drive dock action
- gamepad mapping settings
- mobile controls
- top down map
- videotile
- a lot of the code in the webui folder may be unused or unneeded. when going through the files, check if that function needs to exist, or if the file is used

### COMPLETED COMPONENTS
- 

### LARGE CHANGES
- 