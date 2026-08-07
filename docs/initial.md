# Footie


2D Pixel Soccer Game Mechanics Spec

## Game Summary

Build a singleplayer 2D arcade soccer game. It is called Footie and it is a cute irreverent pixel style. The game must be set up to use **16x16 pixel sprites and tileset-based stadium assets** eventually but in scope right now is just simple shape stand ins unless you think parsing the asset pack is something you can do.

The game uses a slightly top-down stadium perspective matching the provided reference image: the field is viewed from above at a shallow angle, with the far stands visible at the top of the screen.

The player controls one soccer team against a computer-controlled enemy team. The player directly controls one teammate at a time. The rest of the player’s team is controlled by AI behavior. The player can switch the directly controlled teammate with **Shift** and can change the tactical movement behavior of the rest of the team with **Alt**.

The primary control mechanic is mouse-based: the player clicks or click-drags to move the currently controlled player. Clicking and dragging use the same behavior.

The game should feel like a small arcade soccer match, not a full simulation. 

No fouls, offsides, substitutions, stamina, or complex rules are required at this stage.

The game must be built in the style of c/dev/sled-master with a SOLID architecture and should reuse what it can from that game wholemeal. Don't reinvent the wheel. it must use no gpu processing and be runnable directly from the index.html.

---

# Core Design Goals

The game should be:

1. **Simple to control**

   * One active player at a time.
   * Mouse movement or click and drag moves the active player around the pitch.
   * Shift changes controlled player.
   * Alt changes team formation behavior.

2. **Fast and readable**

   * Short matches.
   * Small teams.
   * Clear ball ownership.
   * Clear AI intentions.

3. **Arcade-like**

   * Loose soccer rules.
   * Snappy player movement.
   * Forgiving dribbling and kicking.
   * Ball physics should be simple and fun rather than realistic.

4. **Built around 16x16 sprites**

   * Every character sprite occupies a 16x16 logical sprite cell.
   * Animations use frame sequences from a tileset.
   * Stadium, goals, field markings, crowd, and ball are all tile/sprite driven.

---

# Match Format

## Default Match

* Team size: **5v5**

  * 4 field players
  * 1 goalie
* Match length: **2 minutes**
* Win condition: team with the higher score when time expires.
* If tied at time expiration, enter **sudden death**:

  * First goal wins.
  * Sudden death has no timer.

## Optional Match Lengths

Expose these constants:

```txt
MATCH_TIME_SECONDS = 120
SUDDEN_DEATH_ENABLED = true
TEAM_SIZE = 5
```

---

# Teams

## Player Team

The user controls one team. Only one player is directly controlled at a time.

Player team members:

```txt
PlayerTeam:
- Forward
- MidfielderLeft
- MidfielderRight
- Defender
- Goalie
```

## Enemy Team

The enemy team is fully AI-controlled.

Enemy team members:

```txt
EnemyTeam:
- Forward
- MidfielderLeft
- MidfielderRight
- Defender
- Goalie
```

## Team Sides

At match start:

* Player team starts on the left half of the field.
* Enemy team starts on the right half of the field.
* Player team attacks right.
* Enemy team attacks left.

after halftime or after each goal, sides do **not** need to switch at this stage. Keep direction consistent for simplicity of testing.

---

# Controls

## Mouse Movement Control

The current controlled player moves toward the mouse target.

Both of these should behave the same:

```txt
Click
Click and drag
```

### Behavior

When the user clicks or holds the mouse button:

1. Convert mouse screen position to world position.
2. Set that world position as the controlled player’s movement target.
3. The controlled player moves toward that target.
4. While the mouse button remains held, continuously update the target to the current mouse position.
5. When the mouse button is released, keep the last target until the player reaches it or another input is given.

### Movement Target Rules

* The player should not teleport.
* The player moves with acceleration toward the target.
* If the player is within a small radius of the target, they stop.
* The target should be clamped inside the playable field bounds.

Suggested constants:

```txt
PLAYER_MAX_SPEED = 90 pixels/second
PLAYER_ACCELERATION = 600 pixels/second^2
PLAYER_STOP_RADIUS = 4 pixels
```

---

## Shift: Switch Controlled Player

Pressing **Shift** switches which player on the player team is directly controlled.

### Selection Logic

On Shift press:

1. Cycle to the next non-goalie teammate.
2. If all field players have been cycled, return to the first field player.
3. The goalie is normally skipped unless the ball is inside the defensive box.
4. If the ball is inside the defensive box, Shift may include the goalie in the cycle.

Default cycle:

```txt
Forward -> MidfielderLeft -> MidfielderRight -> Defender -> Forward
```

Conditional defensive cycle:

```txt
Forward -> MidfielderLeft -> MidfielderRight -> Defender -> Goalie -> Forward
```

### Controlled Player Indicator

The currently controlled player should have a small visual indicator, such as:

* A small white ring under their feet.
* A small arrow above their head.
* A subtle blinking pixel marker.

Use a simple indicator that fits the pixel style.

---

## Alt: Switch Formation Behavior

Pressing **Alt** changes the AI pathing behavior of the rest of the player’s team.

This does **not** change which player is controlled. It changes how uncontrolled teammates position themselves.

Alt cycles through these formation modes:

```txt
Balanced -> Attack -> Defend -> Spread -> Balanced
```

Display the active formation briefly on-screen when changed.

Example text:

```txt
Formation: Attack
```

The text can fade after 1 second.

---

# Formation Modes

Formation modes affect only the player team’s uncontrolled teammates.

The currently controlled player ignores formation mode and follows player input.

## Balanced Formation

Default formation.

AI teammates maintain sensible soccer spacing:

* One teammate supports near the ball.
* One teammate stays wider.
* One teammate stays behind the ball.
* Goalie stays near own goal.

Use this as the safest general behavior.

### Balanced Behavior

```txt
Forward:
- Stay ahead of the ball when player team has possession.
- Press the ball carrier when enemy has possession.

Midfielders:
- Stay near the center lane.
- Support the controlled player.
- Move into passing lanes.

Defender:
- Stay between the ball and own goal.
- Do not push too far forward.

Goalie:
- Stay inside goal area.
- Track ball horizontally.
```

---

## Attack Formation

Teammates push forward aggressively.

Use when the player wants pressure and scoring chances.

### Attack Behavior

```txt
Forward:
- Push close to enemy goal.
- Move into shooting lane.

Midfielders:
- Advance past midfield.
- One supports ball side.
- One moves wide for a pass.

Defender:
- Moves up to midfield.
- Stays behind the attacking group.

Goalie:
- Slightly more aggressive positioning but remains inside goal area.
```

### Gameplay Effect

* Better chance to score.
* Worse defensive coverage.
* Enemy counterattacks become more dangerous.

---

## Defend Formation

Teammates drop back and protect own goal.

Use when leading or under pressure.

### Defend Behavior

```txt
Forward:
- Drops toward midfield.
- Presses enemy ball carrier only if nearby.

Midfielders:
- Stay between enemy players and own goal.
- Collapse toward the ball side.

Defender:
- Stays deep.
- Directly guards the path to goal.

Goalie:
- Stays centered in goal.
- Reacts quickly to shots.
```

### Gameplay Effect

* Harder for enemy to score.
* Harder for player team to counterattack.
* Controlled player may need to carry the ball farther alone.

---

## Spread Formation

Teammates space themselves widely.

Use when the player wants open passing lanes and less crowding.

### Spread Behavior

```txt
Forward:
- Moves into open forward space.

Midfielders:
- One moves wide left.
- One moves wide right.

Defender:
- Holds central defensive position.

Goalie:
- Normal goalie behavior.
```

### Gameplay Effect

* More open field.
* Easier to move the ball around.
* Weaker compact defense.

---

# Player Movement

## Movement Model

All players use the same movement system.

Each player has:

```txt
position
velocity
moveTarget
maxSpeed
acceleration
radius
team
role
isControlled
hasBall
```

Recommended collision radius:

```txt
PLAYER_RADIUS = 5 pixels
```

The sprite is 16x16, but collision should be a smaller circle around the feet/body center.

## Movement Rules

* Players accelerate toward their target.
* Players decelerate when close to the target.
* Players cannot leave the playable field.
* Players should avoid overlapping each other.
* If two players collide, gently push them apart.

## Player Collision

Use simple circle collision.

When two players overlap:

1. Compute overlap depth.
2. Push both players away from each other.
3. If one is the controlled player and one is AI, the controlled player gets priority.
4. Avoid hard bouncing. The push should feel soft.

---

# Ball Mechanics

## Ball State

The soccer ball has:

```txt
position
velocity
radius
ownerPlayer
lastTouchedTeam
isPossessed
```

Suggested constants:

```txt
BALL_RADIUS = 3 pixels
BALL_FRICTION = 0.985 per frame
BALL_MAX_SPEED = 260 pixels/second
BALL_PICKUP_RADIUS = 9 pixels
BALL_DRIBBLE_OFFSET = 7 pixels
```

## Ball Movement

If the ball is free:

* It moves according to velocity.
* Friction slows it down.
* It bounces lightly off field boundaries.
* It can enter goals.

If the ball is possessed:

* It stays near the possessing player.
* It appears slightly in front of that player based on movement direction.
* It can be stolen by nearby opponents.

---

# Possession

## Gaining Possession

A player gains possession if:

* The ball is free.
* The player is within pickup radius.
* The ball is moving slowly enough, or the player intercepts it.

Suggested rule:

```txt
Can possess ball if distance(player, ball) < BALL_PICKUP_RADIUS
```

If multiple players are close, possession priority is:

1. Controlled player
2. Closest player
3. Player moving toward the ball fastest

## Dribbling

When the controlled player has the ball:

* The ball follows slightly ahead of the player.
* Movement remains mouse-driven.
* Turning should feel responsive.
* The ball should lag very slightly to make it feel physical.

When AI has the ball:

* The ball follows in front of the AI player.
* AI decides whether to dribble, pass, or shoot.

---

# Kicking

The game needs a simple kicking mechanic that works with mouse movement.

## Controlled Player Kick

The controlled player kicks automatically when:

1. The controlled player has possession.
2. The player clicks or drags in a direction that is far enough from the player.
3. The input target is beyond a minimum kick threshold.
4. The kick cooldown is ready.

The kick direction is from the controlled player toward the mouse target.

Suggested constants:

```txt
KICK_MIN_DISTANCE = 20 pixels
KICK_COOLDOWN = 0.25 seconds
PASS_KICK_POWER = 130 pixels/second
SHOT_KICK_POWER = 220 pixels/second
```

## Kick Strength

Kick strength depends on distance from player to mouse target.

```txt
Short drag/click distance = soft pass
Long drag/click distance = strong shot
```

Use a clamp:

```txt
kickPower = clamp(distanceToMouseTarget * 3, PASS_KICK_POWER, SHOT_KICK_POWER)
```

## Shooting Toward Goal

If the controlled player has possession and the mouse target is near or beyond the enemy goal direction, treat the kick as a shot.

A shot:

* Has higher speed.
* Is aimed toward the target.
* Can score if it crosses the goal line inside the goal mouth.

## Passing

If the controlled player kicks toward a teammate:

* The ball travels freely.
* Nearby teammate AI should move to receive it.
* The nearest teammate to the ball path becomes the likely receiver.

No separate pass button is required.

---

# Tackling and Stealing

There is no tackle button.

Possession changes through proximity and pressure.

## Steal Rule

An opposing player can steal the ball if:

```txt
distance(opponent, ballOwner) < STEAL_RADIUS
```

and

```txt
opponent is between ballOwner and ball
```

or

```txt
ballOwner has been pressured for STEAL_TIME
```

Suggested constants:

```txt
STEAL_RADIUS = 8 pixels
STEAL_TIME = 0.35 seconds
```

## Controlled Player Advantage

The controlled player should have a slight possession advantage so the game does not feel unfair.

Example:

```txt
Controlled player requires 0.45 seconds of enemy pressure to lose ball.
AI players require 0.30 seconds of pressure to lose ball.
```

---

# Passing AI

When the player kicks the ball and it is heading toward a teammate:

* That teammate should enter a `ReceivePass` state.
* The receiver moves toward the predicted ball position.
* Nearby teammates should avoid crowding the receiver.

## Receive Pass Behavior

```txt
If ball is moving and lastTouchedTeam == PlayerTeam:
    nearest teammate to future ball path becomes receiver
    receiver moves to intercept ball
```

The receiver should not be the currently controlled player unless they are already closest.

---

# Enemy AI

The enemy team should use simple but effective soccer AI.

Each enemy player has a state:

```txt
Idle
MoveToFormation
ChaseBall
Dribble
Pass
Shoot
Defend
ReceivePass
GoalieGuard
Celebrate
Lose
```

## Enemy Team Decision Loop

Every AI update:

1. Determine ball state.
2. Determine which team has possession.
3. Assign roles dynamically:

   * Ball chaser
   * Support attacker
   * Defender
   * Wide option
   * Goalie
4. Move players toward their tactical targets.

## Enemy Possession Behavior

If enemy has the ball:

```txt
If close to player goal and has shooting lane:
    Shoot
Else if pressured:
    Pass to open teammate
Else:
    Dribble toward player goal
```

## Enemy Without Possession

If player team has the ball:

```txt
Closest enemy field player:
    Chase ball carrier

Second closest:
    Cut off forward path

Defender:
    Stay between ball and enemy goal

Other players:
    Mark nearby player teammates
```

---

# Goalie Mechanics

Each team has one goalie.

## Goalie Area

Each goalie has a restricted goal box.

Goalies should usually remain inside this box.

Example:

```txt
Top goalie box: near top goal
Bottom goalie box: near bottom goal
```

## Goalie Behavior

Goalie tracks the ball horizontally across the goal mouth.

```txt
Goalie x-position follows ball x-position
Goalie y-position remains near goal line
```

If the ball enters the goalie box:

* Goalie moves toward it.
* If goalie reaches the ball, goalie gains possession.
* After possession, goalie clears the ball toward a teammate or upfield.

## Goalie Saves

If the ball crosses near the goalie:

* The goalie can block the ball by collision.
* The ball bounces or stops.
* If stopped, goalie gains possession.

No dive animation is required unless available.

---

# Goal Detection

A goal occurs when the ball fully crosses the goal line inside the goal mouth.

## Goal Areas

Define two goal rectangles:

```txt
TopGoal:
- Located at top of field
- Enemy defends this goal
- Player scores here

BottomGoal:
- Located at bottom of field
- Player defends this goal
- Enemy scores here
```

## Scoring

When the ball enters the top goal:

```txt
PlayerTeam score += 1
```

When the ball enters the bottom goal:

```txt
EnemyTeam score += 1
```

## After Goal

After a goal:

1. Freeze gameplay for 1 second.
2. Scoring team plays victory animation.
3. Conceding team plays losing animation.
4. Audience plays cheering animation.
5. Reset ball to center.
6. Reset players to formation start positions.
7. Resume after countdown.

Suggested delay:

```txt
GOAL_PAUSE_SECONDS = 1.5
RESET_COUNTDOWN_SECONDS = 1.0
```

---

# Field Bounds

The playable field is the grass area, not the stands or parking/stadium background.

Use a rectangular field bounds area matching the visible field.

Players and ball should be clamped or bounced within this field except when the ball enters a goal.

## Field Boundary Behavior

Players:

* Cannot leave the field.
* Stop at the boundary.

Ball:

* Bounces lightly off side boundaries.
* Can cross goal line only through goal mouth.
* If ball exits behind the goal but not inside the goal mouth, reset with a goal kick.

For MVP, instead of full throw-ins and corner kicks:

```txt
If ball exits side:
    place ball near exit point
    give possession to opposite team

If ball exits behind goal outside goal mouth:
    give goalie possession
```

---

# Simple Out-of-Bounds Rules

Do not implement official soccer restarts. Use simplified arcade restarts.

## Side Out

If ball leaves left or right field boundary:

1. Stop ball.
2. Place ball just inside the boundary.
3. Give possession to the team that did not touch it last.
4. Resume immediately.

## Back Line Out

If ball leaves behind a goal but does not score:

1. Stop ball.
2. Give possession to defending goalie.
3. Goalie clears ball.

---

# Animation System

Use the 16x16 tileset frames for all player animations.

## Player Animations

Available animations:

```txt
Idle
Running
Score Kicking
Victory
Losing
```

## Animation State Mapping

### Idle

Use when:

```txt
player velocity is near zero
player is not kicking
player is not celebrating
player is not losing
```

### Running

Use when:

```txt
player speed > movement threshold
```

Suggested threshold:

```txt
RUN_ANIMATION_THRESHOLD = 8 pixels/second
```

### Score Kicking

Use when:

```txt
player kicks the ball
player shoots
goalie clears ball
```

This animation should temporarily override idle/running.

Suggested duration:

```txt
KICK_ANIMATION_DURATION = 0.25 seconds
```

### Victory

Use when:

```txt
player's team scores
player's team wins match
```

### Losing

Use when:

```txt
player's team concedes a goal
player's team loses match
```

## Facing Direction

If the tileset only has one direction:

* Do not rotate sprites.
* Use horizontal flipping for left/right movement if appropriate.
* Otherwise keep all players facing the same direction.

If directional frames exist:

* Face left when moving left.
* Face right when moving right.
* Face up when moving upward.
* Face down when moving downward.

For this perspective, vertical movement can still use the same running animation if no directional sprites exist.

---

# Audience Animations

Available audience animations:

```txt
Cheering
Booing
```

## Cheering

Play cheering animation when:

* A goal is scored.
* Match begins.
* Match ends.
* A strong shot is taken.

## Booing

Play booing animation when:

* The player misses a shot badly.
* The enemy scores.
* The match ends with player loss.

Optional: crowd reaction can be cosmetic only.

---

# Stadium and Environment

Use the stadium tileset to build:

```txt
Grass field
Field stripes
Center line
Center circle
Penalty boxes or simplified boxes
Goals
Stands
Audience rows
Stadium edge
Background pavement/parking area if included
```

The field should use tiled grass bands like the reference image.

## Visual Perspective

Use the provided perspective:

* Camera is fixed.
* Field extends vertically.
* Top of screen shows stands/stadium structures.
* Players are small 16x16 sprites.
* Goals are at top and bottom of field.
* Movement occurs on the grass field plane.

## Camera

Use a fixed camera.

No scrolling is required for MVP.

If the field is larger than the viewport, use very light camera follow centered between the controlled player and ball, but fixed camera is preferred.

---

# Soccer Ball Sprite

Use the soccer ball tileset frames.

## Ball Animation

If ball has multiple frames:

* Animate while ball speed is above threshold.
* Stop animation when ball is stationary.
* Faster ball movement means faster animation.

Suggested:

```txt
BALL_ANIMATION_SPEED = map(ball speed, 0 to BALL_MAX_SPEED, 0 to 18 fps)
```

If the ball has one frame, just draw it normally.

---

# Goal Sprites

Use goal assets at the top and bottom of the playable field.

Goals should be visually clear and should have collision/score rectangles.

## Goal Collision

Goal posts can block the ball if separate post collision is easy.

MVP option:

* Only detect scoring rectangle.
* Do not simulate post bounces.

Better option:

* Add two small post colliders per goal.
* Ball bounces off posts.
* Ball scores if it crosses between them.

---

# Game States

Use a simple finite state machine.

```txt
Boot
MainMenu
Kickoff
Playing
GoalScored
ResetAfterGoal
MatchOver
Paused
```

## Boot

Load sprites, tileset, animations, sounds if any.

## MainMenu

Show:

```txt
Pixel Soccer
Click to Start
```

## Kickoff

Place all players in starting formation.

Ball starts at center.

After a short countdown, begin play.

```txt
3
2
1
Go
```

## Playing

Normal gameplay.

Timer decreases.

AI updates.

Input updates controlled player.

Ball physics updates.

Goal detection runs.

## GoalScored

Freeze gameplay briefly.

Play victory/losing animations.

Update score.

## ResetAfterGoal

Return players and ball to kickoff positions.

## MatchOver

Show result:

```txt
You Win
You Lose
Draw / Sudden Death
```

If sudden death is enabled and score is tied, enter sudden death instead of ending.

## Paused

Optional. Use Escape to pause.

---

# Kickoff Positions

Use normalized field coordinates so placement works at any resolution.

Assume field coordinates:

```txt
x: 0.0 left to 1.0 right
y: 0.0 top to 1.0 bottom
```

Player team attacks upward.

## Player Team Starting Positions

```txt
Forward:        x 0.50, y 0.62
MidfielderLeft: x 0.35, y 0.72
MidfielderRight:x 0.65, y 0.72
Defender:       x 0.50, y 0.84
Goalie:         x 0.50, y 0.94
```

## Enemy Team Starting Positions

```txt
Forward:        x 0.50, y 0.38
MidfielderLeft: x 0.35, y 0.28
MidfielderRight:x 0.65, y 0.28
Defender:       x 0.50, y 0.16
Goalie:         x 0.50, y 0.06
```

---

# AI Targeting System

Every AI-controlled player should have a tactical target position.

Each frame:

```txt
desiredTarget = formationTarget + ballInfluence + roleInfluence + avoidanceOffset
```

## Formation Target

Base position from the active formation.

## Ball Influence

Players move somewhat toward the ball depending on role.

Example:

```txt
Forward: strong ball influence when attacking
Midfielder: medium ball influence
Defender: low ball influence unless defending
Goalie: horizontal ball influence only
```

## Role Influence

If a player is assigned to chase, receive, mark, or shoot, that role overrides formation target.

## Avoidance Offset

Small offset to avoid overlapping teammates.

---

# AI Role Assignment

For each team, assign roles every 0.25 seconds rather than every frame to avoid jitter.

Suggested:

```txt
AI_ROLE_RECALCULATE_INTERVAL = 0.25 seconds
```

## Roles

```txt
BallChaser
Support
WideSupport
Defender
Goalie
Receiver
```

## BallChaser

Closest appropriate player to the ball.

Behavior:

* Move toward the ball.
* If enemy owns ball, pressure the owner.
* If free ball, attempt possession.

## Support

Moves near the ball carrier but not directly on top of them.

Behavior:

* Stay open for pass.
* Avoid crowding.
* Move forward if team has possession.

## WideSupport

Moves laterally into open space.

Behavior:

* Give passing option.
* Stretch defense.

## Defender

Stays between ball and own goal.

Behavior:

* Maintain defensive line.
* Chase only if ball enters defensive zone.

## Receiver

Assigned when a pass is made.

Behavior:

* Predict ball path.
* Move to intercept.

## Goalie

Uses goalie behavior only.

---

# Enemy Difficulty

Expose a difficulty enum:

```txt
Easy
Normal
Hard
```

## Easy

```txt
Enemy speed multiplier: 0.85
Reaction delay: 0.45 seconds
Shot accuracy: low
Passing frequency: low
```

## Normal

```txt
Enemy speed multiplier: 1.0
Reaction delay: 0.25 seconds
Shot accuracy: medium
Passing frequency: medium
```

## Hard

```txt
Enemy speed multiplier: 1.1
Reaction delay: 0.10 seconds
Shot accuracy: high
Passing frequency: high
```

Default should be Normal.

---

# Shot Logic

A player should shoot if:

```txt
has possession
is facing attacking goal
distance to goal < shooting range
has approximate open lane
```

Suggested:

```txt
SHOT_RANGE = 90 pixels
```

## Shot Accuracy

Shot direction should include slight randomness.

```txt
Easy:   high randomness
Normal: medium randomness
Hard:   low randomness
```

The controlled player’s shots should go where the mouse target indicates.

---

# Passing Logic

AI should pass if:

```txt
has possession
is pressured
teammate is open
teammate is closer to enemy goal
```

Passing should not be too frequent. Add a cooldown.

```txt
AI_PASS_COOLDOWN = 1.0 second
```

---

# Marking Logic

When defending, AI players may mark opponents.

A marking player chooses the nearest enemy player who is:

* In a dangerous area.
* Ahead of the ball.
* Open for a pass.

Marking target position should be between the marked player and the goal.

---

# Controlled Player Feel

The controlled player should feel better than AI teammates.

Use slightly higher responsiveness:

```txt
CONTROLLED_PLAYER_SPEED_MULTIPLIER = 1.08
CONTROLLED_PLAYER_ACCELERATION_MULTIPLIER = 1.15
CONTROLLED_PLAYER_STEAL_RESISTANCE_MULTIPLIER = 1.25
```

Do not make the controlled player overpowered, just more responsive.

---

# UI

## HUD

Display:

```txt
Player score
Enemy score
Match timer
Current formation mode
```

Example:

```txt
Player 2 - 1 Enemy
01:13
Formation: Balanced
```

## Controlled Player Indicator

Draw above or below the controlled player.

## Possession Indicator

Optional but useful:

* Small ball marker near player name/indicator.
* Or subtle highlight when player has possession.

## Formation Change Feedback

When Alt is pressed:

```txt
Formation: Attack
```

Text appears briefly and fades.

## Goal Text

When player scores:

```txt
GOAL!
```

When enemy scores:

```txt
Enemy Goal
```

## Match Result Text

```txt
You Win!
You Lose
Sudden Death
```

---

# Audio

If no sound assets exist, skip audio.

If simple audio is added:

```txt
Kick sound
Goal sound
Crowd cheer
Crowd boo
Whistle
```

Audio is optional.

---

# Rendering Order

Draw in this order:

1. Background stadium tiles
2. Field grass tiles
3. Field markings
4. Goals behind players
5. Ball shadow, if any
6. Players sorted by y-position
7. Ball
8. Goals foreground layer, if any
9. UI/HUD

Sorting players by y-position helps the perspective feel correct.

---

# Sprite Scaling

The source sprites are 16x16.

Recommended display scale:

```txt
SPRITE_SCALE = 2
```

So each sprite draws at:

```txt
32x32 pixels
```

However, collision should still use logical gameplay radius, not full visual sprite size.

Use nearest-neighbor rendering. Disable smoothing.

Canvas setting:

```txt
imageSmoothingEnabled = false
```

---

# Field Coordinate System

Use world coordinates in pixels.

Define:

```txt
fieldRect = {
    x: fieldLeft,
    y: fieldTop,
    width: fieldWidth,
    height: fieldHeight
}
```

All tactical positions should be derived from `fieldRect`.

Normalized tactical point conversion:

```txt
worldX = fieldRect.x + normalizedX * fieldRect.width
worldY = fieldRect.y + normalizedY * fieldRect.height
```

---

# Collision Summary

Required collisions:

```txt
Player vs field bounds
Ball vs field bounds
Ball vs goal scoring rectangles
Player vs player
Player vs ball possession radius
Goalie vs ball
```

Optional collisions:

```txt
Ball vs goal posts
Ball vs players as physical blockers
```

For MVP, possession and player collision are more important than realistic ball bouncing.

---

# Recommended Constants

```txt
TEAM_SIZE = 5

PLAYER_RADIUS = 5
PLAYER_MAX_SPEED = 90
PLAYER_ACCELERATION = 600
CONTROLLED_PLAYER_SPEED_MULTIPLIER = 1.08
CONTROLLED_PLAYER_ACCELERATION_MULTIPLIER = 1.15

BALL_RADIUS = 3
BALL_MAX_SPEED = 260
BALL_FRICTION = 0.985
BALL_PICKUP_RADIUS = 9
BALL_DRIBBLE_OFFSET = 7

KICK_MIN_DISTANCE = 20
PASS_KICK_POWER = 130
SHOT_KICK_POWER = 220
KICK_COOLDOWN = 0.25

STEAL_RADIUS = 8
STEAL_TIME = 0.35

MATCH_TIME_SECONDS = 120
GOAL_PAUSE_SECONDS = 1.5
RESET_COUNTDOWN_SECONDS = 1.0

AI_ROLE_RECALCULATE_INTERVAL = 0.25
AI_PASS_COOLDOWN = 1.0
SHOT_RANGE = 90

RUN_ANIMATION_THRESHOLD = 8
KICK_ANIMATION_DURATION = 0.25
SPRITE_SCALE = 2
```

---

# MVP Implementation Priority

Build in this order:

1. Render stadium/field from tileset.
2. Render players and ball.
3. Mouse click/drag moves controlled player.
4. Ball possession and dribbling.
5. Kicking toward mouse target.
6. Goal detection and score reset.
7. Shift player switching.
8. Basic enemy AI chasing and shooting.
9. Teammate AI formation movement.
10. Alt formation cycling.
11. Animations.
12. Crowd reactions.
13. Match timer and win/loss state.

---

# Non-Goals

Do not implement these for the first version:

```txt
Offside
Fouls
Yellow/red cards
Stamina
Substitutions
Complex physics
Full 11v11 simulation
Online multiplayer
Advanced pathfinding
Slide tackles
Set pieces
Corner kicks
Throw-ins
Penalty shootouts
```

The intended game is a compact arcade soccer game, not a full soccer simulator.

---

# Upgrade addendum (2026-08) — 11v11, true-scale pitch, camera, Team Management, host settings

This addendum records deliberate reversals of the original spec above. The
historical spec is left untouched; where the two disagree, this section wins.

## 11v11 (reverses the "Full 11v11 simulation" non-goal)

The match is now 11v11. Rosters are generated per formation SHAPE from
`src/defs/formationDefs.js` — shapes (4-4-2 / 4-3-3 / 4-2-3-1) are lines of
banded players (DF/DM/MF/AM/FW) run through a parametric generator that emits
mode anchor tables, kickoff spots, the roster (sprite variants 1..10) and the
Shift cycle. The four tactical MODES (balanced/attack/defend/spread, Alt to
cycle) are unchanged and orthogonal to the shape. The enemy always fields the
default shape (4-4-2) in balanced mode — by design, do not "fix" the asymmetry.
The goalie reuses an outfield kit (the pack ships exactly 10 outfield
variants per team and no keeper kit).

## True-to-scale pitch (replaces the 480×312 single-screen world)

8 px/yd, per the standard 11-a-side diagram: pitch 115×74 yd → 920×592 world
px inside a 968×720 world; penalty box 18 yd deep × 44 yd wide; goal box
6×20 yd; penalty spot 12 yd; centre circle 10 yd radius; goal mouth 8 yd
(64 px — larger than the old exaggerated 56 px, so still playable); 1 yd
corner arcs; penalty-arc "D"s. All in `src/defs/fieldDefs.js`.

## Ball-following camera (supersedes "Fixed camera — no scrolling")

The view window is the old world size (480×312, `FIELD.view`) at the same
integer zoom; `RenderEngine` gained viewW/viewH + a clamped camera and
`FootieGame._updateCamera` lerps it toward the ball (`TUNING.camera`),
snapping on match start. Pointer input maps through the camera via
`toWorld`. Known tradeoff: the camera chases the BALL, so a Shift switch far
from play can select an off-screen player; possession-change auto-switching
keeps that rare.

## Team Management screen

New SETUP state between MENU and KICKOFF (`#screen-setup`): the player picks
the formation shape before kickoff (persisted to localStorage under
`FORMATIONS.storageKey`). Markup lives in THREE synced places — index.html,
`src/embedShell.js` SHELL_HTML/EMBED_CSS, and styles/main.css.

## Host settings (the treasure-chest contract)

`settings-manifest.json` (emitted by `tools/emit-settings-manifest.mjs`, run
via `npm run manifest:footie`; regenerating must be byte-identical to the
committed file) declares the admin knobs: match length, sudden death,
default difficulty, default formation. An embedding host passes stored
values back at `GameWorkshopGame.mount(container, { config })`; the bridge
declares `capabilities.hostBridge`. `src/defs/configDefs.js` is the single
source of truth — it drives both the manifest and the merge/validate gate
(any invalid known key → console.error + pure defaults). Host-provided
difficulty/formation win as the INITIAL selection; player picks still work
and persist locally.

---

# Upgrade addendum 2 (2026-08) — PES/Kopanito arcade controls, mechanics & Star Power

Implements the trimmed five-minute-arcade design (Kopanito-inspired), scaled
to our 11v11. Where this contradicts anything above (or addendum 1), this wins.

## Controls — keyboard only (pointer gameplay removed; menus stay clickable)

WASD/arrows move and AIM · J pass (hold = harder; cone-assisted ≤25°, no
target → into space) / switch player without the ball · K tap shot, hold =
PRECISE shot (world slows to 45%, pixel trajectory preview, lateral aim
bends the ball, auto-fires at 0.6s) / slide tackle without the ball (aerial
finish instead when an airborne ball is in reach: header/volley/bicycle by
height band) · L lob/chip (hold = longer) · Shift sprint, with ball =
knock-on (touch escapes above trap speed) · Space = Star Power · Alt cycles
formation modes · Esc pause. InputEngine now tracks held keys + release
edges (lowercased), cleared on blur.

## Mechanics

Ball has pseudo-3D height (z/vz, gravity 300, shadow stays grounded);
crossbar at 21px (8ft) — above it bounces (arcade fiction: invisible wall,
preserves no-corners); outfielders trap below 12, keepers claim to 26
(crosses). Curve = decaying lateral acceleration. Slide tackles knock down
anyone contacted (0.8s, friendly fire, recovery 0.65/0.35), strike the ball
loose (165 — savable), can score, tick downT; poke toes an exposed ball away
from the POKER (never toward the carrier's own net). Goalkeeper: 4 states
(hold-line / track ≤¼ box depth / claim near the goal box only /
emergency-save from 0.9s out) + distribution ≤1.25s to an unmarked defender.
Difficulty no longer changes movement speed (reaction/aim/slide-aggression
only).

## Match format

4:30 regulation; level at full time → golden-goal overtime capped at 0:30 →
draw. Goal = 0.75s celebration + 1.25s reset + auto kickoff.
GamePlayCompleted now carries outcome 'win'|'lose'|'draw' plus a `won`
boolean.

## Star Power (the super system)

The crowd IS the meter: each side's stand bounces harder as its meter fills
(tiers at 0/25/50/75/100 — fraction of fans + fps + seat-stagger wave;
eruption at full and on activation, rival side boos). Meter: pass +6,
line-breaking pass +9, clean tackle +12, shot on target +15, goal +22,
concede +10; max 100, one stored, resets on use, survives goals within a
match. One power per side, picked pre-match on Team Management (enemy rolls
random): **Screamer** (5s window — next hard shot pierces ×1.25 uncapped,
flattens outfielders 1.1s, keepers immune and still catch), **First Touch**
(1.25s — drags the loose ball to you, bends shots, keeper-secured immune),
**Ghost Run** (hold Space + aim, release — blink 120px with the ball, never
into a goal box), **Flat-Footed** (freezes non-GK opponents + the ball in a
90px radius for 0.9s; airborne ball drops on thaw). Activation slow-mo beat;
world.timeScale is owned by FootieGame (min of precise-shot and star
requests); charges accrue in wall time. Admin knobs: starPowerEnabled +
default starPower joined the settings manifest; suddenDeathEnabled is now
labeled "Golden goal overtime".

All new overlay/FX graphics follow the pixel language: 1px pixel-aligned
strokes and square 2px particle "pixels" — same family as the field markings.
