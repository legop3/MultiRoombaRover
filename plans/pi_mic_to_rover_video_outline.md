# general idea
- the pi's microphone needs to be streamed to users
  - as part of the rover's video feed
- the pi model is a zero 2 W
  - it CANNOT handle transcoding the audio onboard, I have tried.
- the server is super powerful and can handle transcoding
- it is NOT acceptable to add more than 100ms of video latency from glass to glass
- it is NOT acceptable to break video streaming for pis that don't have microphones

### OLD, BAD, but working audio configuration that worked for the microphone
```
-f alsa -guess_layout_max 0 -thread_queue_size 2048 -ac 1 -ar 48000 -i plughw:0,0 \
-map 1:a:0 \
-c:a libopus -b:a 24000 -compression_level 0 -application voip -frame_duration 60 \
-ac:a 1 -ar:a 48000 -af "pan=1c|c0=c0,volume=20dB"
```
- the raspberry pi CANNOT HANDLE AUDIO ENCODING onboard. this is just to show you how to use the mic.


sudo systemctl restart roverd
sudo systemctl restart audio-capture
sudo systemctl restart video-publisher
sudo cat /var/lib/roverd/video.env
