/* SPDX-License-Identifier: MIT
 * HE30 adaptation of the AE64 Pro gamepad mapper and XInput state encoder.
 */
#ifndef HE30_GAMEPAD_H
#define HE30_GAMEPAD_H
#include <stdint.h>

#define GP_NONE 255u
#define GP_KEY_COUNT 36u
#define GP_TRAVEL_MAX 10000u
#define GP_CONFIG_BYTES 292u

enum { GP_OFF, GP_CONTROLLER_ONLY, GP_MIXED };
enum { GP_DEPTH_DIFFERENCE, GP_NEUTRAL_ON_BOTH, GP_DEEPER_WINS };

/* Slot order is left/right/up/down for each stick, then LT and RT.
 * All travel and curve values use 0..10000 of calibrated switch travel. */
typedef struct __attribute__((packed)) {
    uint8_t key;
    uint16_t start, end, x[4], y[4];
} GpAnalog;

/* A, B, X, Y, LB, RB, Back, Start, L3, R3, D-pad up/down/left/right. */
typedef struct __attribute__((packed)) {
    uint8_t key;
    uint16_t press, release;
} GpDigital;

typedef struct __attribute__((packed)) {
    uint16_t deadzone;
    uint8_t circular, opposition_x, opposition_y;
} GpStick;

typedef struct __attribute__((packed)) {
    uint8_t version, mode;
    GpAnalog analog[10];
    GpDigital digital[14];
    GpStick stick[2];
} GpConfig;

typedef struct {
    int16_t lx, ly, rx, ry;
    uint16_t buttons;
    uint8_t lt, rt, dpad;
} GpReport;

typedef struct {
    uint32_t last_frame_tick;
    uint16_t digital_latches;
    uint8_t needs_release, has_frame;
    GpReport report;
} GpState;

_Static_assert(sizeof(GpConfig) == GP_CONFIG_BYTES, "gamepad wire layout");

void gp_defaults(GpConfig *config);
int gp_valid(const GpConfig *config);
int gp_bound(const GpConfig *config, uint8_t key);
void gp_reset(GpState *state);
/* Validate configurations before installing them, then reset the state after
 * every mapping/profile change. The positions are the scanner's 0..1000 units.
 * complete must be false for stale, disabled, uncalibrated or failed inputs. */
int gp_update(GpState *state, const GpConfig *config,
              const uint16_t positions[GP_KEY_COUNT], int complete,
              uint32_t now);
int gp_watchdog(GpState *state, uint32_t now, uint32_t max_age);
void gp_encode(const GpReport *report, uint8_t output[20]);
#endif
