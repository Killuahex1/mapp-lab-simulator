# MAPP Lab Simulator (ET1010)

Open **`MAPP Lab Simulator.html`** in Chrome/Edge. It's a single offline file (no install, no internet needed), so you can send it to friends as-is.

It simulates the lab PC:
- **File Explorer** with `D:\MAPP Programs` (`MAPP Lab`, `Utilities`, `NUCLEO_F103RB` template). Copy, paste, rename and delete work like Windows.
- **Keil µVision 5 look-alike**: open `NUCLEO_F103RB.uvprojx`, remove `main.cpp`, use Add Existing Files to Group, edit, Build (F7), and Flash > Download (F8). Error messages follow Arm Compiler 6 style, including linker errors L6218E and L6200E.
- **MAPP Experiment Board**: LED bar, DIP switches (PB12/PA4/PD2), buttons, buzzer, 4-digit 7-segment display, 20x2 LCD (HD44780 emulated at pin level) and the 74C922 keypad.
- **Tera Term**: shows `printf()` output.
- **Lab Test Practice**: ticks off each procedure step automatically and auto-marks Parts 1-3 plus the Challenging Drill on the downloaded program.

The desktop **Reset Files** icon puts every file back to its original state. Student work is saved in the browser's localStorage.

## Developing
- Sources are in `src/`. Rebuild the single HTML file with  
  `node build.js "<path to extracted MAPP Programs folder>"`
- Local test server: `node serve.js` (http://localhost:8765)

Not supported: UART `BufferedSerial`, the debugger, structs/classes, and dynamic memory. Register-level code compiles, but the peripherals behind it aren't simulated.
