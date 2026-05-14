# why?
- right now, video and HUD elements are scattered across components
- some HUD elements have code baked into large video tiles and HUDs and stuff.

## organization rules:
in the end we should have:
- a component that JUST plays video and audio
- a driver video panel, which combines the video component and all of the proper HUD elements for drivers
- a spectator video panel, which combines the video component and all of the proper HUD elements for spectators
- ALL of the HUD elements each as their own component, in a folder of HUD elements. each in its own folder.
- NO MORE HUD elements built into video panels, tiles, or whatever.
- no visual or functional changes of anything. this is all just code restructuring
- follow the new structure of the components, each one is its own folder, etc. split them up into separate files where reasonable, for large components