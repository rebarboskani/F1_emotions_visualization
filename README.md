## F1 Driver Emotions Visualization

![F1 Emotions Visualization](public/Intro.webp)

Interactive recreation of the Abu Dhabi 2021 F1 emotions in a modern web stack. The app uses Next.js 16, React 19, and Three.js to render an orbiting particle ring for every driver and lap, translating telemetry-derived emotion metrics into colour, motion, and bloom intensity.

- **Live exploration** – scrub through laps and see pressure, confidence, frustration, aggressiveness, and risk-taking values per driver.
- **GPU-accelerated scene** – additive particle system with 20k particles + 2k sparks per driver, bloom post-processing, and OrbitControls.
- **Full data pipeline** – A single Python script downloads telemetry via FastF1, computes emotion scores, and stores the JSON the frontend consumes.

---

### Project Layout

- `app/page.tsx` – server component that fetches data with `getEmotionsData()` and renders the visualization.
- `components/F1Visualization.tsx` – client component that mounts the Three.js scene, lap selector, and emotion breakdown UI.
- `lib/emotions.ts` – file-system backed data loader with in-memory caching.
- `data/` – bundled dataset ready for the UI (`f1_emotions_data.json`).
- `src/generator.py` – CLI that fetches telemetry, computes all emotion scores, and rebuilds `data/f1_emotions_data.json`.

---

### Frontend Flow

1. `app/page.tsx` is a server component and calls `getEmotionsData()` during SSR.
2. `F1Visualization` receives the JSON payload and:
   - builds concentric particle rings per driver,
   - maps emotion values to rotation, wobble, shake, thickness, and colour variations,
   - exposes a lap dropdown, per-driver stats, and fallback messaging.
3. Emotion updates are applied by mutating buffer attributes each animation frame for 60fps performance.

---

### Data Pipeline Overview

`src/generator.py` automates the entire backend data prep:

1. Downloads the requested session directly from FastF1 (laps, car telemetry, race control events).
2. Calculates the five emotion scores using telemetry features such as tyre wear, throttle smoothness, position deltas, and DRS usage (logic matches the diagrams below).
3. Normalises scores per lap and writes `data/f1_emotions_data.json` in the exact shape expected by the frontend.
4. Progress bars (via `tqdm`) show driver/lap processing status in the terminal.

---

### Getting Started (Web App)

Prerequisites
- Node.js 18+
- npm 9+

Install and run:

```bash
npm install
npm run dev
```

Visit `http://localhost:3000` and use the lap selector to explore the scene.

Production build:

```bash
npm run build
npm run start
```

Linting:

```bash
npm run lint
```

---

### Regenerating the Dataset

Prerequisites
- Python 3.10+
- `pip install -r requirements.txt`
- FastF1 account/API access (free) for telemetry downloads.

Steps (defaults to the 2021 Abu Dhabi race):

```bash
python src/generator.py
```

Customise the target session as needed:

```bash
python src/generator.py --year 2022 --event "Saudi Arabian" --session R --output data/f1_emotions_data.json
```

Outputs:
- Fresh `data/f1_emotions_data.json` for the frontend (identical schema to the committed sample).
- Cached FastF1 responses under `cache/` for faster reruns (ignored by Git).

---

### Mathematical Model

Below are the derived metrics visualised in the app.

**Aggressiveness**

```math
\begin{aligned}
\text{Aggressiveness\_Score} =&\; 0.25 \left( \frac{\text{avg\_throttle}}{100} \right) \\
&+ 0.15 \, \max\!\left(0.1, 1 - \frac{\text{tyre\_life}}{\text{expected\_tyre\_life}}\right) \\
&+ 0.2 \left( \frac{1}{\text{normalized\_corrected\_lap\_times}} \right) \\
&+ 0.2 \, e^{\frac{\text{avg\_distance\_to\_drive\_ahead}}{10}} \\
&+ 0.15 \, \frac{\min\!\left(1.0, 2 \times \text{DRS\_usage\_count}\right)}{\text{max\_possible\_DRS}} \\
&+ 0.3 + 0.05 \left(1 - \text{brake\_on\_time\_ratio}\right) \\
&+ 0.15 \, \min\!\left(1.0, 1 - \frac{\text{position} - 1}{\text{total\_drivers}}\right)
\end{aligned}
```

*Wobble amplitude linked to Aggressiveness*

![Aggressiveness visualization](public/Aggressiveness.webp)

**Confidence**

```math
\begin{aligned}
\text{Confidence\_Score} =&\; \max\!\left(0.1,\; 1 - \text{corrected\_lap\_variability}\right) \\
&\times \left(\frac{\text{avg\_throttle}}{100}\right) \\
&\times \max\!\left(0.1,\; \text{corrected\_sector\_consistency}\right) \\
&\times \max\!\left(0.1,\; 1 - \text{brake\_time\_variability}\right) \\
&\times \left(\frac{1}{1 + \text{tyre\_life}}\right) \\
&\times \begin{cases}
1, & \text{if no\_pit\_this\_lap} \\
0.5, & \text{otherwise}
\end{cases}
\end{aligned}
```

*Oscillation amplitude linked to Confidence*

![Confidence visualization](public/Confidence.webp)

**Frustration**

```math
\begin{aligned}
\text{Frustration\_Score} =&\; \max\!\left(0.1,\; \text{corrected\_lap\_time\_delta}\right) \\
&\times \max\!\left(0.1,\; \frac{\text{sector\_loss\_count}}{3}\right) \\
&\times \max\!\left(0.1,\; \frac{\text{brake\_application\_count}}{\text{lap\_distance}} \times \text{scaling\_factor}\right) \\
&\times \max\!\left(0.1,\; \frac{\text{gear\_shift\_inefficiency}}{\text{max\_gear\_shifts}}\right) \\
&\times \begin{cases}
1.5, & \text{if pit\_this\_lap} \\
1, & \text{otherwise}
\end{cases} \\
&\times \max\!\left(1.0,\; \text{race\_control\_impact}\right) \\
&\times \text{championship\_pressure\_factor}
\end{aligned}
```

*Orbital Speed linked to Frustration*

![Frustration visualization](public/Frustration.webp)

**Pressure**

```math
\begin{aligned}
\text{Pressure\_Score} =&\; \max\!\left(0.1,\; \frac{1}{1 + \text{distance\_to\_driver\_behind}}\right) \\
&\times \max\!\left(1.0,\; \text{track\_status\_penalty}\right) \\
&\times \min\!\left(2.0,\; \text{air\_temp\_factor} + \text{track\_temp\_factor}\right) \\
&\times \left(\frac{\text{tyre\_life}}{\text{expected\_tyre\_life} + 0.1}\right) \\
&\times \left(1 + \frac{\text{fuel\_penalty}}{\text{avg\_lap\_time}}\right) \\
&\times \left(1 + \frac{\text{position}}{\text{total\_drivers}}\right)
\end{aligned}
```

*Thickness linked to Pressure*

![Pressure visualization](public/Pressure.webp)

**Risk Taking**

```math
\begin{aligned}
\text{Risk\_Taking\_Score} =&\; \left(\frac{\text{max\_speed}}{\text{track\_avg\_speed}}\right) \\
&\times \max\!\left(0.1,\; \frac{\text{DRS\_usage\_count}}{\text{max\_possible\_DRS} + 1}\right) \\
&\times \left(\frac{\text{avg\_RPM}}{\text{max\_RPM}}\right) \\
&\times \max\!\left(0.1,\; \frac{\text{brake\_application\_count}}{\text{lap\_distance}} \times \text{scaling\_factor}\right) \\
&\times \max\!\left(0.1,\; \frac{1}{\text{corrected\_sector\_time\_variability} + 0.1}\right) \\
&\times \text{compound\_risk\_factor}
\end{aligned}
```

*Particle shakiness linked to Risk-Taking*

![Risk-taking visualization](public/Risk-Taking.webp)

**Extra**

| **Data Type** | **Calculation Logic** |
|---------------|----------------------|
| `avg_throttle` | Average throttle percentage over telemetry samples in the lap. |
| `expected_tire_life` | Predefined constant based on compound and track (e.g., 15 laps for soft). |
| `corrected_lap_time` | `LapTime_sec - fuel_penalty - tire_deg_penalty`, where `fuel_penalty = 0.035 * remaining_fuel_mass`, `tire_deg_penalty = d[compound] * TireLife`. |
| `normalized_corrected_lap_time` | `corrected_lap_time / session_best_corrected_lap_time`. |
| `DRS_usage_count` | Count of samples where `DRS > 0`. |
| `max_possible_DRS` | Track-specific (e.g., 200 samples for Abu Dhabi). |
| `brake_on_time_ratio` | Proportion of samples where `Brake = True`. |
| `corrected_lap_time_variability` | Standard deviation of `corrected_lap_time` over last 3 laps divided by mean. |
| `corrected_sector_time` | `SectorTime - (fuel_penalty / 3) - (tire_deg_penalty / 3)`. |
| `brake_time_variability` | Standard deviation of `brake_on_time_ratio` over last 3 laps divided by mean. |
| `no_pit_this_lap` | `True` if no `PitInTime` or `PitOutTime`. |
| `distance_to_driver_behind` | `DistanceToDriverAhead` of the immediate trailing driver. |
| `track_status_penalty` | `1.5` for Yellow/SC/VSC, `1.0` for Green. |
| `air_temp_factor` | `AirTemp / 25` (optimal). |
| `track_temp_factor` | `TrackTemp / 35` (optimal). |
| `fuel_penalty` | `0.035 * remaining_fuel_mass`. |
| `avg_lap_time` | Mean `LapTime_sec` per driver across session. |
| `max_speed` | Maximum speed per lap. |
| `track_avg_speed` | Mean `max_speed` across drivers. |
| `avg_RPM` | Mean RPM per lap. |
| `max_RPM` | `15,000.00`. |
| `brake_application_count` | Count of `False` → `True` brake transitions. |
| `lap_distance` | Maximum distance per lap. |
| `corrected_sector_time_variability` | Standard deviation of `corrected_sector_times`. |
| `compound_risk_factor` | `1.2 (SOFT)`, `1.0 (MEDIUM)`, `0.8 (HARD)`. |
| `corrected_lap_time_delta` | `(current - previous corrected_lap_time) / previous` if positive, else 0. |
| `sector_loss_count` | Number of sectors greater than personal best. |
| `gear_shift_inefficiency` | Count of RPM drops > 2000 without speed gain on gear change. |
| `pit_penalty` | `1.5` if pit occurred or duration > 20s. |
| `race_control_impact` | `1.5` for negative messages (keyword match). |
| `championship_pressure_factor` | For contenders: `1 + (Position - 1) * (LapNumber / 58)`; else `1.0`. |



---
