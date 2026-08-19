- start work on new better ui layout, using components that already exist when possible
- centered rover video, full screen height
  - rover HUD contains small but expandable rover telemetry UI and vis
  - make newgen folder for new HUD elements. reuse old elements where possible
  - make all new hud elements small and clean
  - every hud element:
    - is a nice small translucent thing with text icons or both
    - can be expanded to show more relavent information
    - is consistent. maybe make a reusable thing for this
  - some specific hud elements:
    - top bar:
      - battery percentage that goes red and flashes and such
      - turns hud that shows people in queue
    - big in the middle
      - left and right sides
        - wheel drop indicators that show up when wheel drop is happening
      - overcurrent and battery warnings
    - bottom section:
      - sensor elements that show up only when the sensor is "happening"
        - bumpers
        - front IR proximity sensors
- two sidebars
  - sidebars contain all the stuff that isnt the rover
  - left
    - idk
  - right
    - chat, users, rovers list, and replay sources
- everything involving the rover is a video HUD, everything external is in the sidebars




## section 2

There will be corner mounted (one pod in each corner of the video), rounded pods in the HUD, which will contain gauges and controls for the rover

These pods will be collapsible, with a corner mounted arrow. the arrow points towards the corner when the pod is out, and points out of the corner when the pod is hidden.

There can also be "pod expansions" that will be in the corner of the pod and the side of the video. These are also collapsible, but they collapse into the side of the video that they are touching, instead of collapsing into the corner, with the same style arrow button as the pods.

For example, a pod in the top left is open. This pod has an expansion to it's right that is also open. I can collapse the pod into the corner, the expansion stays, it gets moved into the top left corner where the pod was.

- corner pods:
  - top left
    - pod
      - turns timer
        - round gauge circle that ticks down with time
        - inside it, is the turn countdown
      - this pod goes away when theres nothing to count
    - right of pod expansion
      - rover name with colored background
      - expanded by default
  - top right
    - pod
      - round rover battery bar gauge, based off how battery bar looks
      - concentric to this bar is an unlabeled current gauge, styled after the current bar that the top down map contains
      - inside the circle, is the battery percentage.
    - left of pod expansion
      - dock assist button and keybind
      - expanded by default
    - below pod expansion
      - combined advanced power view for the roomba with other info from rover host stats
  - bottom left
    - pod
      - has circular buttons for laser, horn, and headlight
      - each button is a related icon and the keybind label for the feature
      - arranged nicely
      - horn button is larger, and contains an arrow to open the horn settings menu
      - this pod disappears when none of these things are enabled
      - if one of the button's features is not enabled, that button should go away
  - bottom right
    - pod
      - rounded camera tilt slider, with keybind label on each end for up / down
      - in the area inside the slider, show the tilt degrees
      - clicking the degrees label should set camera tilt to 0