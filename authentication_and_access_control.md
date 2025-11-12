# access control modes:
- open
  - open to the public
  - users are randomly assigned a rover to drive, with priority on the rover with the least amount of drivers
  - if there are multiple people on one rover, those people will all be controlling that rover at the same time
- turns
  - open to the public
  - users are randomly assigned to a rover same as open mode
  - if there are multiple people on one rover, they will each have one minute at a time to drive.
  - the turn queue loops
  - the rover will stop moving and stop all aux. motors if the turn switches to a different person
- admin
  - admin authentication is required to access the driver page at all
- lockdown
  - ONLY lockdown admins can access the driver page
  - the future spectator page is DISABLED (not even a way to log into it)

# roles in the access control system:
- user
  - default, for normal people who visit the site
- admin
  - authentication needed
  - can drive and view any rover when not on lockdown, no matter who is controlling it
  - can switch modes (including switching to lockdown mode)
- lockdown admin
  - authentication needed
  - only works if said admin has lockdown: enabled in config
  - can ALWAYS access and control EVERYTHING that there is to do on the site

# other things to keep in mind:
- in the future, there will be a Discord bot for community alerts and a few admin controls
  - wherever the admin list is configured, there has to be a spot for their discord ID
  - admin's discord IDs are linked to their admin name server-side