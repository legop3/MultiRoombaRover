1. fix up ALL discord admin commands
   1. make sure all permissions are correct
   2. fuzzy search all the things
   3. dont break on multi word nicknames
   4. make all rs commands work form both the site chat and discord
      1. make sure all the permissions are correct
2. make alert feed.jsx show more alerts at once
3. unify typing row and chat row, should be simple
4. actual barcode stuff fun
   1. games
      1. all games are global and initiated by a user
         1. all games will require you to scan yourself to keep going sometimes too
         2. only one game at a time
      2. scan quest mode, scan 2 items in specific order or something
      3. most scanned items
         1. global counters
         2. you have to 
5. overseer improvements
   1. make it able to see rover activity
      1. when they are docked / undocked
      2. whos driving them
      3. their battery levels / low
   2. make the overseer panel better
      1. show status of generation if possible, tokens or percentage. possibly stream from ollama unless i cant with tools
6. roomba odometer
   1. in activities tab
   2. use wheel encoders
   3. run averages, like 2 meters and how many encoder counts, 20 times
   4. have global odometers for each rover, tagged based on name
7.  maybe make a better joystick for mobile
8.  make google tts the default everywhere but roverd
9.  fix rover request spam queue cheat


# relative pipe dreams:
1. VPS video forwarding
   1. get forwarding working with the VPS for in-queue users and spectators
   2. bandwidth testing
   3. maybe switch room cams back to real video, with audio?
2. overseer LED tesseract
3. RF based positional tracking / room map tab
4. chromecast monitor youtube search and speakers