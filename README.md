# FINAL BOSS CAT — demo beta

A browser-based 2D beat 'em up. You play **Grimalkin the Ninefold**, the final boss of all cats, holding the Nine-Pointed Crown against a coup by the Pretender clans on the Throne-Moon of Miu.

The full space lore is in [LORE.md](LORE.md). It's also in the game's **Codex** menu.

## Play

Open `index.html` in a browser. There's no build step and nothing to install, and it runs straight from `file://`.

If your browser blocks local files, serve the folder instead:

```sh
python -m http.server 8000   # then open http://localhost:8000
```

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Move | Arrows / WASD | D-pad / left stick |
| Monofilament Talons (3-hit combo) | J / Z | A |
| Jump (attack in the air = Gravity Pounce) | K / X / Space | B |
| Primordial Hiss — AoE roar, 35 static | L / C | X |
| Static Singularity — electric breath beam, 60 static | I / V | Y |
| Pause | Esc / P | Start |
| Mute | M | |

Landing hits builds **STATIC**. You're super-armored while roaring or breathing, and you have **nine lives**.

## Demo content

- **Stage 1: The Throne-Moon of Miu.** Three waves, then a boss:
  1. Can-Opener Thralls: humans under the Treat Signal
  2. Solar Tabby Legion: gold cats that pounce from mid range
  3. Void Siamese Syndicate: green cats that blink behind you
  4. **Regent Vermillia of the Crimson Court**: claw combos, a plasma fireball barrage, pounces and a roar. She has two phases and super armor.
- Intro crawl, Codex (11 lore entries), combo counter, pickups (Nebula Nip heals, Static stars refill energy), victory and game-over endings.
- Procedural WebAudio sound effects and a synth music loop. There are no audio files.

## Project layout

```
index.html                 entry point
src/game.js                engine, player, enemies, waves, HUD, scenes
src/audio.js               procedural SFX + music
src/lore.js                in-game text (intro, codex, endings)
assets/atlas.js            generated sprite metadata (window.ATLAS)
assets/sprites/            generated sprite strips & images
tools/extract_sprites.py   slices fbcatsprites.png -> assets/
fbcatsprites.png           source sprite sheet
```

### Regenerating sprites

`fbcatsprites.png` is a flat illustration with no transparency. The extractor crops each frame from hand-measured cells, keys out the navy background as a solid silhouette plus a glow halo, and writes hue-shifted copies for the enemy clans (`solar`, `void`, `crimson`).

```sh
pip install pillow numpy scipy
python tools/extract_sprites.py
```

Tweak the frame centers and crop rows in `ANIMS` / `SINGLES` at the top of the script.
