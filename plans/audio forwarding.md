# main idea:
- stream audio from server to rovers
- users can either stream their mic from their browser
- users can also play audio files on the rover through the browser
- this is a VIP feature for verified users only
  - gate in UI and in the server

## specifics
- only the current driver can play audio through a rover
- admins can enable / disable audio
- lockdown admins can adjust the volume for all rovers
- rovers are always listening for an audio stream from the server
  - no transcoding allowed on-rover due to resources
- rovers are always local and cant be accessed from outside, no security is needed for audio streaming