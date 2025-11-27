# general idea
- the pi on each roomba will have a speaker and microphone
- alsa devices
  - they are both the default audio device
- you will have to modify roverd, the pi install script, and the server to get this all to work

# adding stuff to installation script
- I am using the google voice AIY v1 kits for audio
- boot config stuff
  - enable `dtoverlay=googlevoicehat-soundcard`
  - disable `dtparam=audio=on`
- copy asound.conf in pi folder to /etc/asound.conf

# microphone
- add microphone to the SRT publish stream

# speaker
- user's chat messages will be TTS'ed through the speaker on the pi
  - either flite with a way to choose the voice
  - or espeak where you can choose the pitch
- on the web UI and in the chat API
  - add new stuff to chat
    - only shows up if you are on a rover
    - only shows up if TTS is enabled on that rover
  - people can choose between flite or espeak
    - if they choose flite, they can choose the voice from the default flite voices (exclude awb and awb_time)
    - if they choose espeak, they can choose the pitch. Have a dropdown with increments of 10 from 0 to 99