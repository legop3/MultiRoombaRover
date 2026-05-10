# RULES FOR LOCKDOWN AUDIT
## why is lockdown a thing?
lockdown mode exists so that the physical owner of the server can get some privacy. 
during lockdown mode, no one can spectate anything or replay anything
users cant use the site, its locked
admins cant log in
ONLY lockdown admins can log in and use the site as normal

## what should not work at all during lockdown?:
- spectator pages should be disabled
- llm services should be paused
- 

## what should be disabled server-side for users during lockdown (to prevent people manually sending socket commands and stuff)?:
- sending commands to rovers
- requesting replays (both from socket and discord)
- audio forwarding
- using room controls
- using the lift
- using the neato
- cant view video
- cant stream audio
- cant view room cameras
- cant request and drive a rover

## lockdown admin rule:
- lockdown admins should be able to log in and use ALL features as normal, even during lockdown
- non-lockdown admins are not able to log in at all during lockdown.

## web ui lockdown rules:
- show admin login overlay on driver page, already correct i think
- show disabled overlay on spectator pages, also already good i think
- dont worry about disabling buttons and stuff. anything unallowed will be blocked server-side, and there will be the overlay in UI.