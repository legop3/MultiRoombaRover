# spectate system overhaul
- rip out and remake the entire page
  - basically keep nothing from it
- right now the spectator page is a mess, and hasn't been updated in a while
  - does not work properly, aside from the page being out of date
- the spectate page should use modules from the driver page
- there should be no such thing as a "spectate mode" on the driver page. If someone wants to spectate, they must go to the spectator page.

## rules of the spectator page
- spectators are not allowed to drive
- spectators are not allowed to chat
- spectators are not allowed to have nicknames
- spectators are not allowed to login as admin
- these are the permissions for spectators based on the sever's access control mode
  - open
    - spectators can spectate
  - turns
    - spectators can spectate
  - admin
    - spectators can spectate
  - lockdown
    - spectators can NOT spectate


## what should be on the spectator page?
- for each rover
  - video component
  - current driver
  - sensor telemetry component
- logs
- room cameras
- online user list

## layout and styling of the spectator page
- use same styling style as the driver page
- feel free to add spectator role checks to hide the features that spectators can't use in certain components.
- mainly designed for a 4:3 monitor
  - make use of the vertical space
- a row of columns, one for each rover at the top
- below the row of columns:
  - 50/50 split
    - user list
    - chat
  - room cameras