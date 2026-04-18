# button box mechanic
- a box with 4 buttons which sends web requests to the server when a button is pressed
- each button has a counter in the server
- when the counter's goal is met, the reward happens

## rewards
- theres a list of rewards in the server
- rewards create chaos in different ways using the physical things that already exist
- rewards have actions and a counter goal set per reward to assign value to better rewards
- when a reward is met, the button gets a new goal, reset counter, and new reward

## UI
- a new full-width panel above the room cameras in the main tab
- divided into columns, one for each of the 4 buttons
  - each columns shows:
  - button number
  - current count
  - reward and reward number
  - column flashes when button gets upped
  - column plays a sound when button gets upped. same tone as the button.
- match styling and layout rules of the rest of the ui

### reward ideas
1. dock panic
   force all online rovers to run seek-dock immediately, interrupting whatever it was doing and causing sudden behavior change
2. camera whiplash
   apply a short burst of random camera servo nudges on all rovers so the view jerks around rapidly for a moment
3. light strobe
   toggle all configured room controls on and off repeatedly for 10 seconds
4. ghost typing spam
   emit fake typing events into chat so users see rapid typing indicators from fake/ghost senders without actual messages
5. darkness
   turn room lights off for 1 minute and force rover night-vision/headlight state off for that same window, then restore normal state
6. discord stalker ping
   send a chaos alert message to the configured discord general channel and ping the configured stalker role
7. rogue event spam
   push a burst of fake alert events with random titles/colors into the web ui alert feed for jump-scare style noise
8. mode jam
   switch server mode to admin for a short timed window, set admin reason to a chaos message at activation, then restore previous mode and previous admin reason
9. assignment roulette
   forcibly release current user rover assignments/drivers and let assignment logic re-place users, causing sudden rover ownership reshuffle
10. chat spam
    spam random letters in chat as an injected spectator user with a random letter name
