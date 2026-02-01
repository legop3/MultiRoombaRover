# general idea:
- consolidate each rover control button to it's own component which is used standalone
- rework mobile controls (throw away the current left column)
- check for duplicates of any control components in redundant places
- main culprits
  - dock drive action
  - mobile control columns
  - night vision (headlight) button
  - horn button
  - camera tilt slider
- also plan to rework mobile controls, but just ensure consolidation first
  
## dock / drive action:
- ensure that it is one standalone component
- revamp the system which allows it to hide / show other componenets that it "covers"

## camera tilt slider:
- the biggest issue currently
  - it seems to be the root of the problems of things not being consolidated
- ensure that it is ONLY the camera slider component
- keep styling
- add option for a vertical slider with just a degrees number at the top

## night vision (headlight) button
- center label, make it large and match the labels of the horn and drive/dock action labels
- center status badge
- allow height class to be changed for different modes
  
## horn button
- the newest one
- mostly good
- for mobile layouts, make it hide the settings by default, and when shown make them nicely laid out for fitting in a skinny column on mobile


# new mobile control columns:
- get rid of the current entire left column with all the aux buttons, we are replacing it
- the new left column:
  - top section
    - vertical camera slider
    - night vision button
  - middle section (two new buttons, side by side)
    - all aux forward button
    - all aux backward button
  - bottom section
    - horn button
- the modified right column:
  - no more camera slider
  - no more night vision toggle
  - still dock/drive action full-column, which minimizes itself
  - when minimized, make the dock button a little taller