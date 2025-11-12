"""Generate the visualization dataset directly from FastF1 telemetry."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, Tuple

import fastf1
import numpy as np
import pandas as pd

try:  # pragma: no cover - optional dependency fallback
    from tqdm.auto import tqdm
except ImportError:  # pragma: no cover
    def tqdm(iterable, **kwargs):  # type: ignore
        return iterable

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = PROJECT_ROOT / "cache"
DATA_DIR = PROJECT_ROOT / "data"
OUTPUT_JSON = DATA_DIR / "f1_emotions_data.json"

TEAM_COLORS = {
    "HAM": "#00D2BE",
    "BOT": "#00D2BE",
    "VER": "#0600EF",
    "PER": "#0600EF",
    "LEC": "#DC0000",
    "SAI": "#DC0000",
    "NOR": "#FF8700",
    "RIC": "#FF8700",
    "ALO": "#0090FF",
    "OCO": "#0090FF",
    "VET": "#006F62",
    "STR": "#006F62",
    "GAS": "#2B4562",
    "TSU": "#2B4562",
    "LAT": "#005AFF",
    "GIO": "#B12040",
    "MSC": "#FFFFFF",
}


@dataclass(frozen=True)
class SessionConfig:
    year: int
    event: str
    session: str  # e.g. "R", "Q", "FP1"


def to_seconds(series: pd.Series) -> pd.Series:
    """Convert a pandas timedelta / string column to seconds as float."""
    return pd.to_timedelta(series, errors="coerce").dt.total_seconds()


def normalise_series(values: pd.Series | Iterable[float]) -> pd.Series:
    """Normalise a sequence to the [0, 1] range, guarding against 0 range."""
    if isinstance(values, pd.Series):
        series = values.astype("float64")
    else:
        series = pd.Series(values, dtype="float64")
    min_val = series.min()
    max_val = series.max()
    if pd.isna(min_val) or pd.isna(max_val):
        return pd.Series(np.zeros(len(series)), index=series.index)
    if np.isclose(max_val, min_val):
        return pd.Series(np.zeros(len(series)), index=series.index)
    return (series - min_val) / (max_val - min_val)


def enable_cache(cache_dir: Path) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    fastf1.Cache.enable_cache(cache_dir)


def load_session_data(config: SessionConfig) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Load laps, telemetry, and race control data for the given session."""
    enable_cache(CACHE_DIR)
    session = fastf1.get_session(config.year, config.event, config.session)
    session.load(telemetry=True, laps=True, weather=True, messages=True)

    laps = session.laps.copy()
    if laps.empty:
        raise RuntimeError("Session returned no laps. Check event/session parameters.")

    laps["Driver"] = laps["Driver"].astype(str)
    laps["LapNumber"] = pd.to_numeric(laps["LapNumber"], errors="coerce").astype("Int64")
    laps = laps[laps["LapNumber"].notna()].copy()
    laps["LapNumber"] = laps["LapNumber"].astype(int)

    telemetry_frames: list[pd.DataFrame] = []
    for driver_code in tqdm(session.drivers, desc="Drivers", unit="driver"):
        driver_meta = session.get_driver(driver_code)
        driver_abbr = driver_meta["Abbreviation"]
        driver_laps = session.laps.pick_driver(driver_abbr)
        if driver_laps.empty:
            continue

        lap_numbers = (
            pd.to_numeric(driver_laps["LapNumber"], errors="coerce")
            .dropna()
            .astype(int)
            .unique()
        )
        for lap_number in tqdm(
            lap_numbers,
            desc=f"{driver_abbr} laps",
            leave=False,
            unit="lap",
        ):
            lap_slice = driver_laps.pick_laps([lap_number])
            if lap_slice.empty:
                continue
            lap = lap_slice.iloc[0]
            try:
                car_data = lap.get_car_data()
                car_data = car_data.add_distance().add_driver_ahead()
            except Exception:  # pragma: no cover - FastF1 edge cases
                continue

            if car_data.empty:
                continue

            telemetry_frame = pd.DataFrame(car_data)
            telemetry_frame["Driver"] = driver_abbr
            telemetry_frame["LapNumber"] = lap_number
            telemetry_frames.append(
                telemetry_frame[
                    [
                        "Driver",
                        "LapNumber",
                        "Throttle",
                        "Brake",
                        "DRS",
                        "DistanceToDriverAhead",
                        "Speed",
                        "RPM",
                        "Distance",
                    ]
                ]
            )

    telemetry = (
        pd.concat(telemetry_frames, ignore_index=True)
        if telemetry_frames
        else pd.DataFrame(
            columns=[
                "Driver",
                "LapNumber",
                "Throttle",
                "Brake",
                "DRS",
                "DistanceToDriverAhead",
                "Speed",
                "RPM",
                "Distance",
            ]
        )
    )

    telemetry["LapNumber"] = pd.to_numeric(telemetry["LapNumber"], errors="coerce").astype("Int64")
    telemetry.dropna(subset=["LapNumber", "Driver"], inplace=True)
    telemetry["LapNumber"] = telemetry["LapNumber"].astype(int)
    telemetry["Driver"] = telemetry["Driver"].astype(str)
    telemetry["Brake"] = (
        telemetry["Brake"]
        .replace({"TRUE": True, "FALSE": False})
        .fillna(False)
        .astype(bool)
    )

    race_control = session.race_control_messages.copy()
    race_control["Lap"] = pd.to_numeric(race_control.get("Lap"), errors="coerce")

    return laps, telemetry, race_control


def calculate_aggressiveness(laps: pd.DataFrame, telemetry: pd.DataFrame) -> pd.DataFrame:
    laps = laps.copy()
    telemetry = telemetry.copy()

    total_race_laps = max(1, int(laps["LapNumber"].max()))
    initial_fuel = 110.0
    k_fuel = 0.035
    deg_rates = {
        "SOFT": 0.12,
        "MEDIUM": 0.06,
        "HARD": 0.03,
        "INTERMEDIATE": 0.09,
        "WET": 0.15,
    }
    expected_life = {
        "SOFT": 15,
        "MEDIUM": 30,
        "HARD": 45,
        "INTERMEDIATE": 20,
        "WET": 10,
    }
    max_possible_drs = 200.0
    total_drivers = max(1, int(laps["Driver"].nunique()))
    gap_scale = 10.0
    title_contenders = {"VER", "HAM"}

    laps["Compound"] = laps.get("Compound", "").fillna("").astype(str).str.upper()
    laps["LapTime_sec"] = to_seconds(laps["LapTime"])
    laps = laps[laps["LapTime_sec"].notna() & (laps["LapTime_sec"] > 0)].copy()

    laps["remaining_fuel_mass"] = initial_fuel - laps["LapNumber"] * (initial_fuel / total_race_laps)
    laps["fuel_penalty"] = k_fuel * laps["remaining_fuel_mass"]
    laps["TyreLife"] = pd.to_numeric(laps.get("TyreLife"), errors="coerce").fillna(0.0)
    laps["tyre_deg_penalty"] = laps.apply(
        lambda row: deg_rates.get(row["Compound"], 0.06) * row["TyreLife"],
        axis=1,
    )
    laps["corrected_lap_time"] = laps["LapTime_sec"] - laps["fuel_penalty"] - laps["tyre_deg_penalty"]

    session_best = laps["corrected_lap_time"].min()
    if pd.isna(session_best) or session_best <= 0:
        session_best = laps["corrected_lap_time"].replace(0, np.nan).min()
    if pd.isna(session_best) or session_best <= 0:
        session_best = 1.0
    laps["normalized_corrected_lap_time"] = laps["corrected_lap_time"] / session_best

    tele_agg = (
        telemetry.groupby(["Driver", "LapNumber"], observed=True)
        .agg(
            avg_throttle=("Throttle", "mean"),
            brake_on_time_ratio=("Brake", lambda x: np.mean(x.astype(float))),
            DRS_usage_count=("DRS", lambda x: np.sum(x > 0)),
            avg_distance_to_driver_ahead=("DistanceToDriverAhead", "mean"),
        )
        .reset_index()
    )

    tele_agg["avg_distance_to_driver_ahead"] = tele_agg["avg_distance_to_driver_ahead"].fillna(1000.0)

    merged = laps.merge(tele_agg, on=["Driver", "LapNumber"], how="left")
    merged["avg_throttle"] = merged["avg_throttle"].fillna(merged["avg_throttle"].mean()).fillna(50.0)
    merged["brake_on_time_ratio"] = merged["brake_on_time_ratio"].fillna(
        merged["brake_on_time_ratio"].mean()
    ).fillna(0.1)
    merged["DRS_usage_count"] = merged["DRS_usage_count"].fillna(0.0)
    merged["avg_distance_to_driver_ahead"] = merged["avg_distance_to_driver_ahead"].fillna(1000.0)

    merged["throttle_factor"] = merged["avg_throttle"].clip(lower=0, upper=100) / 100.0
    merged["tyre_factor"] = 1.0 - (
        merged["TyreLife"].astype(float)
        / merged["Compound"].map(expected_life).fillna(30.0)
    )
    merged["tyre_factor"] = merged["tyre_factor"].clip(lower=0.1)
    merged["time_factor"] = 1.0 / merged["normalized_corrected_lap_time"].replace(0, np.nan)
    merged["time_factor"] = merged["time_factor"].fillna(1.0)
    merged["gap_factor"] = np.exp(-merged["avg_distance_to_driver_ahead"] / gap_scale)
    merged["drs_factor"] = (2.0 * merged["DRS_usage_count"] / max_possible_drs + 0.3).clip(upper=1.0)
    merged["brake_factor"] = 1.0 - merged["brake_on_time_ratio"].clip(lower=0, upper=1)
    merged["position_factor"] = merged.apply(
        lambda row: 1.2 - row.get("Position", total_drivers) / total_drivers
        if row["Driver"] in title_contenders and row.get("Position", total_drivers) <= 5
        else 0.8,
        axis=1,
    )

    merged["raw_score"] = (
        0.25 * merged["throttle_factor"]
        + 0.15 * merged["tyre_factor"]
        + 0.20 * merged["time_factor"]
        + 0.20 * merged["gap_factor"]
        + 0.15 * merged["drs_factor"]
        + 0.05 * merged["brake_factor"]
        + 0.15 * merged["position_factor"]
    )

    merged["aggressiveness_score"] = normalise_series(merged["raw_score"]).clip(0.0, 1.0)

    return (
        merged.loc[:, ["Driver", "LapNumber", "aggressiveness_score"]]
        .dropna(subset=["Driver", "LapNumber"])
        .sort_values(["Driver", "LapNumber"])
        .reset_index(drop=True)
    )


def _rolling_variability(series: pd.Series, window: int = 3) -> pd.Series:
    std = series.rolling(window, min_periods=2).std()
    mean = series.rolling(window, min_periods=2).mean()
    variability = std / mean.replace(0, np.nan)
    return variability.fillna(0.1)


def calculate_confidence(laps: pd.DataFrame, telemetry: pd.DataFrame) -> pd.DataFrame:
    laps = laps.copy()
    telemetry = telemetry.copy()

    laps["LapTime_sec"] = to_seconds(laps["LapTime"])
    laps["Sector1Time_sec"] = to_seconds(laps.get("Sector1Time"))
    laps["Sector2Time_sec"] = to_seconds(laps.get("Sector2Time"))
    laps["Sector3Time_sec"] = to_seconds(laps.get("Sector3Time"))
    laps = laps[laps["LapTime_sec"].notna() & (laps["LapTime_sec"] > 0)].copy()

    sector_cols = ["Sector1Time_sec", "Sector2Time_sec", "Sector3Time_sec"]
    for col in sector_cols:
        if col not in laps:
            laps[col] = np.nan

    best_sectors = (
        laps.groupby("Driver")[sector_cols]
        .min()
        .replace(0, np.nan)
    )

    def sector_consistency(row: pd.Series) -> float:
        driver_best = best_sectors.loc[row["Driver"]]
        deviations = 1 - np.abs(row[sector_cols] - driver_best) / driver_best
        deviations = deviations.replace([np.inf, -np.inf], np.nan).fillna(0.1)
        return float(np.clip(deviations.mean(), 0.1, 1.0))

    laps["sector_consistency"] = laps.apply(sector_consistency, axis=1)

    laps.sort_values(["Driver", "LapNumber"], inplace=True)
    laps["lap_time_variability"] = (
        laps.groupby("Driver")["LapTime_sec"]
        .transform(lambda s: _rolling_variability(s, window=3))
        .fillna(0.1)
    )

    tele_agg = (
        telemetry.groupby(["Driver", "LapNumber"], observed=True)
        .agg(
            avg_throttle=("Throttle", "mean"),
            brake_on_time_ratio=("Brake", lambda x: np.mean(x.astype(float))),
        )
        .reset_index()
    )

    tele_agg["brake_variability"] = (
        tele_agg.sort_values(["Driver", "LapNumber"])
        .groupby("Driver")["brake_on_time_ratio"]
        .transform(lambda s: _rolling_variability(s, window=3))
        .fillna(0.1)
    )

    merged = laps.merge(tele_agg, on=["Driver", "LapNumber"], how="left")
    merged["avg_throttle"] = merged["avg_throttle"].fillna(merged["avg_throttle"].mean()).fillna(50.0)
    merged["brake_on_time_ratio"] = merged["brake_on_time_ratio"].fillna(
        merged["brake_on_time_ratio"].mean()
    ).fillna(0.1)
    merged["brake_variability"] = merged["brake_variability"].fillna(
        merged["brake_variability"].mean()
    ).fillna(0.1)

    merged["lap_consistency_factor"] = 1.0 - merged["lap_time_variability"].clip(0, 1)
    merged["throttle_factor"] = (merged["avg_throttle"] / 100.0).clip(0, 1)
    merged["sector_consistency_factor"] = merged["sector_consistency"].clip(0, 1)
    merged["brake_smoothness_factor"] = 1.0 - merged["brake_variability"].clip(0, 1)
    merged["PitInTime"] = merged.get("PitInTime")
    merged["PitOutTime"] = merged.get("PitOutTime")
    merged["pit_factor"] = np.where(
        merged["PitInTime"].isna() & merged["PitOutTime"].isna(),
        1.0,
        0.6,
    )

    merged["raw_score"] = (
        0.35 * merged["lap_consistency_factor"]
        + 0.25 * merged["sector_consistency_factor"]
        + 0.20 * merged["throttle_factor"]
        + 0.15 * merged["brake_smoothness_factor"]
        + 0.05 * merged["pit_factor"]
    )

    merged["confidence_score"] = normalise_series(merged["raw_score"]).clip(0.0, 1.0)

    return (
        merged.loc[:, ["Driver", "LapNumber", "confidence_score"]]
        .dropna(subset=["Driver", "LapNumber"])
        .sort_values(["Driver", "LapNumber"])
        .reset_index(drop=True)
    )


def calculate_frustration(laps: pd.DataFrame, race_control: pd.DataFrame) -> pd.DataFrame:
    laps = laps.copy()
    race_control = race_control.copy()

    laps["LapTime_sec"] = to_seconds(laps["LapTime"])
    laps = laps[laps["LapTime_sec"].notna() & (laps["LapTime_sec"] > 0)].copy()
    laps["LapNumber"] = pd.to_numeric(laps["LapNumber"], errors="coerce").astype(int)
    laps.sort_values(["Driver", "LapNumber"], inplace=True)

    driver_best = laps.groupby("Driver")["LapTime_sec"].transform("min")
    laps["relative_loss"] = (laps["LapTime_sec"] - driver_best) / driver_best.replace(0, np.nan)
    laps["relative_loss"] = laps["relative_loss"].clip(lower=0).fillna(0)

    laps["Position"] = pd.to_numeric(laps["Position"], errors="coerce")
    laps["position_change"] = laps.groupby("Driver")["Position"].diff().fillna(0)
    laps["positions_lost"] = laps["position_change"].clip(lower=0)

    laps["PitInTime"] = laps.get("PitInTime")
    laps["PitOutTime"] = laps.get("PitOutTime")
    laps["pit_stop_flag"] = np.where(
        laps["PitInTime"].notna() | laps["PitOutTime"].notna(),
        1.0,
        0.0,
    )

    race_control["Lap"] = pd.to_numeric(race_control["Lap"], errors="coerce").fillna(0).astype(int)
    lap_event_counts = race_control.groupby("Lap").size()
    max_events = lap_event_counts.max() if not lap_event_counts.empty else 1
    lap_event_factor = (lap_event_counts / max_events).reindex(laps["LapNumber"].unique(), fill_value=0)
    lap_event_map = lap_event_factor.to_dict()
    laps["race_control_intensity"] = laps["LapNumber"].map(lap_event_map).fillna(0.0)

    laps["loss_component"] = normalise_series(laps["relative_loss"])
    laps["position_component"] = normalise_series(laps["positions_lost"])
    laps["race_control_component"] = normalise_series(laps["race_control_intensity"])

    laps["raw_score"] = (
        0.55 * laps["loss_component"]
        + 0.25 * laps["position_component"]
        + 0.15 * laps["race_control_component"]
        + 0.05 * laps["pit_stop_flag"]
    )

    laps["frustration_score"] = normalise_series(laps["raw_score"]).clip(0.0, 1.0)

    return (
        laps.loc[:, ["Driver", "LapNumber", "frustration_score"]]
        .dropna(subset=["Driver", "LapNumber"])
        .sort_values(["Driver", "LapNumber"])
        .reset_index(drop=True)
    )


def _distance_to_driver_behind(
    lap_positions: pd.DataFrame, distance_ahead: pd.DataFrame
) -> pd.DataFrame:
    follower = (
        lap_positions.merge(distance_ahead, on=["Driver", "LapNumber"], how="left")
        .rename(columns={"Position": "FollowerPosition", "avg_distance_to_driver_ahead": "gap_to_ahead"})
    )
    follower["Position"] = follower["FollowerPosition"] - 1
    follower = follower[follower["Position"] >= 1]
    follower = follower.loc[:, ["LapNumber", "Position", "gap_to_ahead"]]
    follower.rename(columns={"gap_to_ahead": "distance_to_driver_behind"}, inplace=True)
    return follower


def calculate_pressure(laps: pd.DataFrame, telemetry: pd.DataFrame) -> pd.DataFrame:
    laps = laps.copy()
    telemetry = telemetry.copy()

    laps["LapNumber"] = pd.to_numeric(laps["LapNumber"], errors="coerce").astype(int)
    laps["LapTime_sec"] = to_seconds(laps["LapTime"])
    laps = laps[laps["LapTime_sec"].notna() & (laps["LapTime_sec"] > 0)].copy()
    laps["Position"] = pd.to_numeric(laps["Position"], errors="coerce")
    laps["TyreLife"] = pd.to_numeric(laps.get("TyreLife"), errors="coerce").fillna(0)

    total_drivers = max(1, int(laps["Driver"].nunique()))
    max_lap = max(1, int(laps["LapNumber"].max()))

    tele_agg = (
        telemetry.groupby(["Driver", "LapNumber"], observed=True)
        .agg(
            brake_on_time_ratio=("Brake", lambda x: np.mean(x.astype(float))),
            avg_distance_to_driver_ahead=("DistanceToDriverAhead", "mean"),
        )
        .reset_index()
    )

    tele_agg["avg_distance_to_driver_ahead"] = tele_agg["avg_distance_to_driver_ahead"].fillna(1000.0)
    tele_agg["brake_on_time_ratio"] = tele_agg["brake_on_time_ratio"].fillna(0.1)

    merged = laps.merge(tele_agg, on=["Driver", "LapNumber"], how="left")
    merged["avg_distance_to_driver_ahead"] = merged["avg_distance_to_driver_ahead"].fillna(1000.0)
    merged["brake_on_time_ratio"] = merged["brake_on_time_ratio"].fillna(0.1)

    lap_positions = merged.loc[:, ["LapNumber", "Driver", "Position"]]
    distance_ahead = tele_agg.loc[:, ["Driver", "LapNumber", "avg_distance_to_driver_ahead"]]
    distance_behind = _distance_to_driver_behind(lap_positions, distance_ahead)

    merged = merged.merge(distance_behind, on=["LapNumber", "Position"], how="left")
    merged["distance_to_driver_behind"] = merged["distance_to_driver_behind"].fillna(1000.0)

    merged["gap_ahead_component"] = 1.0 / (1.0 + merged["avg_distance_to_driver_ahead"])
    merged["gap_behind_component"] = 1.0 / (1.0 + merged["distance_to_driver_behind"])
    tyre_max = max(1.0, merged["TyreLife"].max())
    merged["tyre_wear_component"] = merged["TyreLife"] / tyre_max
    merged["position_component"] = (total_drivers - merged["Position"].fillna(total_drivers)) / total_drivers
    merged["lap_phase_component"] = merged["LapNumber"] / max_lap
    merged["brake_component"] = merged["brake_on_time_ratio"].clip(0, 1)

    merged["gap_ahead_component"] = normalise_series(merged["gap_ahead_component"])
    merged["gap_behind_component"] = normalise_series(merged["gap_behind_component"])
    merged["tyre_wear_component"] = normalise_series(merged["tyre_wear_component"])
    merged["position_component"] = normalise_series(merged["position_component"])
    merged["lap_phase_component"] = normalise_series(merged["lap_phase_component"])
    merged["brake_component"] = normalise_series(merged["brake_component"])

    merged["raw_score"] = (
        0.3 * merged["gap_ahead_component"]
        + 0.2 * merged["gap_behind_component"]
        + 0.2 * merged["tyre_wear_component"]
        + 0.15 * merged["lap_phase_component"]
        + 0.10 * merged["position_component"]
        + 0.05 * merged["brake_component"]
    )

    merged["pressure_score"] = normalise_series(merged["raw_score"]).clip(0.0, 1.0)

    return (
        merged.loc[:, ["Driver", "LapNumber", "pressure_score"]]
        .dropna(subset=["Driver", "LapNumber"])
        .sort_values(["Driver", "LapNumber"])
        .reset_index(drop=True)
    )


def calculate_risk_taking(laps: pd.DataFrame, telemetry: pd.DataFrame) -> pd.DataFrame:
    laps = laps.copy()
    telemetry = telemetry.copy()

    laps["LapNumber"] = pd.to_numeric(laps["LapNumber"], errors="coerce").astype(int)
    laps["LapTime_sec"] = to_seconds(laps["LapTime"])
    laps = laps[laps["LapTime_sec"].notna() & (laps["LapTime_sec"] > 0)].copy()
    laps["Position"] = pd.to_numeric(laps["Position"], errors="coerce")
    laps.sort_values(["Driver", "LapNumber"], inplace=True)
    laps["position_change"] = laps.groupby("Driver")["Position"].diff().fillna(0)
    laps["positions_gained"] = (-laps["position_change"]).clip(lower=0)
    max_lap = max(1, int(laps["LapNumber"].max()))

    tele_agg = (
        telemetry.groupby(["Driver", "LapNumber"], observed=True)
        .agg(
            max_speed=("Speed", "max"),
            avg_rpm=("RPM", "mean"),
            drs_usage=("DRS", lambda x: np.mean(x > 0)),
            brake_ratio=("Brake", lambda x: np.mean(x.astype(float))),
            lap_distance=("Distance", "max"),
        )
        .reset_index()
    )

    tele_agg["max_speed"] = tele_agg["max_speed"].fillna(tele_agg["max_speed"].mean())
    tele_agg["avg_rpm"] = tele_agg["avg_rpm"].fillna(tele_agg["avg_rpm"].mean())
    tele_agg["drs_usage"] = tele_agg["drs_usage"].fillna(0.0)
    tele_agg["brake_ratio"] = tele_agg["brake_ratio"].fillna(tele_agg["brake_ratio"].mean()).fillna(0.5)
    tele_agg["lap_distance"] = tele_agg["lap_distance"].fillna(tele_agg["lap_distance"].mean())

    merged = laps.merge(tele_agg, on=["Driver", "LapNumber"], how="left")
    merged["max_speed"] = merged["max_speed"].fillna(merged["max_speed"].mean())
    merged["avg_rpm"] = merged["avg_rpm"].fillna(merged["avg_rpm"].mean())
    merged["drs_usage"] = merged["drs_usage"].fillna(0.0)
    merged["brake_ratio"] = merged["brake_ratio"].fillna(0.5)
    merged["lap_distance"] = merged["lap_distance"].fillna(merged["lap_distance"].mean())

    merged["speed_component"] = normalise_series(merged["max_speed"])
    merged["rpm_component"] = normalise_series(merged["avg_rpm"])
    merged["drs_component"] = normalise_series(merged["drs_usage"])
    merged["brake_off_component"] = normalise_series(1.0 - merged["brake_ratio"])
    merged["position_gain_component"] = normalise_series(merged["positions_gained"])
    merged["lap_phase_component"] = normalise_series(merged["LapNumber"] / max_lap)

    merged["raw_score"] = (
        0.35 * merged["speed_component"]
        + 0.20 * merged["rpm_component"]
        + 0.20 * merged["drs_component"]
        + 0.15 * merged["brake_off_component"]
        + 0.07 * merged["position_gain_component"]
        + 0.03 * merged["lap_phase_component"]
    )

    merged["risk_taking_score"] = normalise_series(merged["raw_score"]).clip(0.0, 1.0)

    return (
        merged.loc[:, ["Driver", "LapNumber", "risk_taking_score"]]
        .dropna(subset=["Driver", "LapNumber"])
        .sort_values(["Driver", "LapNumber"])
        .reset_index(drop=True)
    )


def normalize_emotions_for_lap(drivers_info: Iterable[dict]) -> list[dict]:
    drivers = list(drivers_info)
    emotions = ["aggressiveness", "confidence", "frustration", "pressure", "risk_taking"]
    ranges = {}

    for emotion in emotions:
        values = [
            driver["emotions"][emotion]
            for driver in drivers
            if not pd.isna(driver["emotions"][emotion])
        ]
        if not values:
            ranges[emotion] = {"min": 0.0, "range": 1.0}
            continue
        min_val = float(min(values))
        max_val = float(max(values))
        ranges[emotion] = {"min": min_val, "range": max(max_val - min_val, 1e-6)}

    for driver in drivers:
        for emotion in emotions:
            value = driver["emotions"][emotion]
            if pd.isna(value):
                driver["emotions"][emotion] = 0.5
                continue
            range_info = ranges[emotion]
            driver["emotions"][emotion] = (
                value - range_info["min"]
            ) / range_info["range"]
            driver["emotions"][emotion] = float(np.clip(driver["emotions"][emotion], 0.0, 1.0))
    return drivers


def build_lap_dataset(
    laps: pd.DataFrame, scores: Dict[str, pd.DataFrame]
) -> Tuple[Dict[int, dict], list[int]]:
    available_laps = sorted(int(lap) for lap in laps["LapNumber"].unique())
    lap_data: Dict[int, dict] = {}

    for lap in available_laps:
        lap_rows = laps[laps["LapNumber"] == lap]
        active = lap_rows[lap_rows["Position"].notna() & (lap_rows["Position"] > 0)]
        if active.empty:
            continue

        drivers_info = []
        for _, driver_row in active.sort_values("Position").iterrows():
            driver = driver_row["Driver"]
            position = int(driver_row["Position"])

            emotions = {}
            for key, df in scores.items():
                match = df[
                    (df["Driver"] == driver) & (df["LapNumber"] == lap)
                ]
                column = f"{key}_score" if f"{key}_score" in match.columns else key
                value = match[column].iloc[0] if not match.empty else np.nan
                emotions[key if key != "risk_taking" else "risk_taking"] = float(value) if not pd.isna(value) else np.nan

            driver_info = {
                "driver": driver,
                "position": position,
                "color": TEAM_COLORS.get(driver, "#808080"),
                "emotions": {
                    "aggressiveness": emotions.get("aggressiveness", np.nan),
                    "confidence": emotions.get("confidence", np.nan),
                    "frustration": emotions.get("frustration", np.nan),
                    "pressure": emotions.get("pressure", np.nan),
                    "risk_taking": emotions.get("risk_taking", np.nan),
                },
            }
            drivers_info.append(driver_info)

        if not drivers_info:
            continue

        normalized = normalize_emotions_for_lap(drivers_info)
        lap_data[lap] = {"lap": lap, "drivers": normalized}

    return lap_data, available_laps


def save_json_data(lap_data: Dict[int, dict], available_laps: list[int], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "available_laps": available_laps,
        "lap_data": lap_data,
    }
    output_path.write_text(json.dumps(payload, indent=2))
    print(f"Saved visualization dataset to {output_path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate the F1 driver emotions dataset directly from FastF1 telemetry.",
    )
    parser.add_argument("--year", type=int, default=2021, help="Championship year (default: 2021).")
    parser.add_argument(
        "--event",
        type=str,
        default="Abu Dhabi",
        help="Grand Prix name as recognised by FastF1 (default: 'Abu Dhabi').",
    )
    parser.add_argument(
        "--session",
        type=str,
        default="R",
        help="Session identifier (e.g. FP1, FP2, Q, R). Default: R (race).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=OUTPUT_JSON,
        help=f"Path to write the JSON dataset (default: {OUTPUT_JSON}).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = SessionConfig(year=args.year, event=args.event, session=args.session)
    print(
        f"Loading telemetry for {config.year} {config.event} ({config.session})..."
    )

    laps, telemetry, race_control = load_session_data(config)

    print("Calculating emotion scores...")
    aggr = calculate_aggressiveness(laps, telemetry)
    conf = calculate_confidence(laps, telemetry)
    frus = calculate_frustration(laps, race_control)
    press = calculate_pressure(laps, telemetry)
    risk = calculate_risk_taking(laps, telemetry)

    scores = {
        "aggressiveness": aggr,
        "confidence": conf,
        "frustration": frus,
        "pressure": press,
        "risk_taking": risk,
    }

    print("Building visualization payload...")
    lap_data, available_laps = build_lap_dataset(laps, scores)
    save_json_data(lap_data, available_laps, args.output)
    print(
        f"Processed {len(lap_data)} laps ranging from {min(available_laps)} to {max(available_laps)}."
    )


if __name__ == "__main__":
    main()