# Multi Roomba Rover
A system for controlling create 2 compatible roombas through a webpage.

You can explore my basement through this project here:
https://rover.otter.land

## This guide is a work in progress, it will cover:
- Building rovers
- Installing roverd on a rover's raspberry pi
- Setting up the server

## Building a rover
You WILL need some common hobby electronics knowledge to build one of these, I will not be making a super detailed wiring or assembly guide, some of building your rover will be up to you, things such as a protective cage, camera and electronics mounting will not be covered in any great detail.

### Parts per rover

| Part | Notes |
| --- | --- |
| Create 2 compatible Roomba with the mini DIN port | Tested only with 600 series Roombas, your mileage may vary with newer models |
| 4S li-ion -> 5v Voltage regulator | I use cheapo 12-24v USB car chargers, tear them apart, and solder wires onto them |
| 7 pin mini DIN cable | Adafruit sells these labeled as a cable specifically for the iRobot Create 2 |
| Logic level shifter | I use ones from adafruit, the Roomba is 5v logic and the pi is 3.3v logic |
| Google voice AIY hat v1 | This serves three purposes: speaker, microphone, and a high current LED driver. None of these things are required to make a rover with a camera that can drive around, but it makes it much more fun. The design of this hat also makes it very easy to connect all of the various wires to all the IO on the pi that they need to go to. |
| Raspberry pi zero 2 W | This will run roverd to control the rover and manage some Roomba safety things locally. You can probably use any pi you want, but these are usually the cheapest. |
| A good wifi adapter | Has to work with Linux 6.12 (I use ones with the MT7921AU chipset and they work  great), ideally wifi 6 with MU-MIMO if you are running multiple rovers on one AP. The built in wifi on the pi zero 2 W is NOT good enough for this. |
| A USB hub hat (if using a pi zero) | If you are using a raspberry pi zero, you will want a USB hub hat for your wifi adapter, I would not recommend using an OTG adapter as it may not provide enough power. |
| ----CAMERA STUFF---- | ----Below here is all camera related things that youll need---- |
| A pi camera v2 (ov5647) | The video publisher in this project is only designed for the ov5647, though it would be totally possible to make your own publisher for other sensors. |
| Cheap 5v servo | Unless you have a VERY wide camera lens, you will want to have a servo plugged into the pi to be able to tilt the camera up and down. |
| LED for toggling night vision | I use white LEDs attached to one of the "driver" pins on the AIY hat to trick one of those generic pi camera LED floodlights into turning on / off on demand.|
| Pi zero camera cable | The pi zero has a smaller version of the camera ribbon connector, you will need the right cable for your camera |

I do not have any exact numbers, but with cheap used Roombas it seems like on average one of my rovers takes about $100 USD to build from scratch.

### Physical assembly of the rover  
This is going to be the very loose section of this guide, the way yout build your rover is up to you. I have mine built out with durable protective metal cages as they are open to the internet and people like breaking things. The electronics on top of the roomba can be as simple as a pi, level shifter, and a camera if you just want to run it around yourself, things like a speaker, microphone, servo, night vision LED, are all totally optional and can be disabled in the configuration on the raspberry pi.

These are the basics of how evertything is connected on my rovers, this is hard to organize and illustrate through text but hopefully it will give you a good idea:
1. 7 pin mini DIN cable
   1. Voltage regulator on the two pairs of VBAT wires
      1. 5v output of voltage regulator connected to the power input on the AIY hat
   2. level shifter's high voltage side attached to 5v from regulator, ground, TX, RX, and BRC from the DIN cable
2. Level shifter low voltage side connected to 3.3v from the pi, with serial TX and RX, and the BRC pin on their respective low side level shifter lines. BRC pin goes to GPIO 4 on the pi.
3. Google voice AIY hat:
   1. speaker
   2. microphone
   3. servo motor on GPIO pin 26
4. Camera stuff:
   1. ov5647 camera
   2. full size to pi zero style camera ribbon cable, plug camera into pi
   3. an LED connected to a high current driver output on the AIY hat, GPIO 22 by default. This is meant to be poked into the LDR sensor on a pi camera IR floodlight to make it toggleable by the driver.

### Software on your rover
Raspberry pi OS installation:

Everything that runs on the pi is designed for debian Bookworm, because I could not get the AIY voice hat working in Trixie.

To install roverd on your pi:
1. Install `Raspberry Pi OS (Legacy) Lite` (exactly what its called in the imager) on your SD card
2. Boot the pi up, plug in your good wifi adapter, use `nmtui` to set it up
3. Install `git`, clone this repo into your home folder
4. Move into the repo folder, run the roverd installer using `sudo pi/install_roverd.sh`
5. Reboot your raspberry pi
6. Roverd, along with the audio and video publishers should now be running. Roverd should have created it's default config file at `etc/roverd.yaml`
