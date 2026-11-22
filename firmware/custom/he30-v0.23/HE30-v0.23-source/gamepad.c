/* SPDX-License-Identifier: MIT
 * Adapted from AE64 Pro's ae64_gamepad.c. Integer curve interpolation, radial
 * normalization, opposition, hysteresis and XInput button masks follow it.
 * HE30 uses 36 scan positions and an explicit packed 292-byte configuration.
 */
#include "gamepad.h"
#ifndef VERIFY_ENTRY
#define VERIFY_ENTRY
#endif

VERIFY_ENTRY __attribute__((section(".spare"),noinline)) void gp_defaults(GpConfig *config) {
    *config = (GpConfig){0};
    config->version = 1;
    config->mode = GP_CONTROLLER_ONLY;
    const uint16_t points[4] = {0, 3333, 6667, GP_TRAVEL_MAX};
    for (unsigned i = 0; i < 10; ++i) {
        GpAnalog *binding = &config->analog[i];
        binding->key = GP_NONE;
        binding->end = GP_TRAVEL_MAX;
        for (unsigned j = 0; j < 4; ++j)
            binding->x[j] = binding->y[j] = points[j];
    }
    for (unsigned i = 0; i < 14; ++i) {
        config->digital[i].key = GP_NONE;
        config->digital[i].press = 5000;
        config->digital[i].release = 3000;
    }
    config->stick[0].circular = config->stick[1].circular = 1;
}

__attribute__((section(".spare"),noinline)) int gp_valid(const GpConfig *config) {
    if (!config || config->version != 1 || config->mode > GP_MIXED) return 0;
    uint32_t seen[2] = {0, 0};
    for (unsigned i = 0; i < 24; ++i) {
        const uint8_t key = i < 10 ? config->analog[i].key : config->digital[i - 10].key;
        if (key != GP_NONE) {
            if (key >= GP_KEY_COUNT || (seen[key >> 5] & (1u << (key & 31)))) return 0;
            seen[key >> 5] |= 1u << (key & 31);
        }
        if (i < 10) {
            const GpAnalog *binding = &config->analog[i];
            if (binding->start >= binding->end || binding->end > GP_TRAVEL_MAX) return 0;
            for (unsigned j = 0; j < 4; ++j)
                if (binding->x[j] > GP_TRAVEL_MAX || binding->y[j] > GP_TRAVEL_MAX ||
                    (j && binding->x[j] <= binding->x[j - 1])) return 0;
        } else {
            const GpDigital *binding = &config->digital[i - 10];
            if (binding->press <= binding->release || binding->press > GP_TRAVEL_MAX) return 0;
        }
    }
    for (unsigned i = 0; i < 2; ++i) {
        const GpStick *stick = &config->stick[i];
        if (stick->deadzone >= GP_TRAVEL_MAX || stick->circular > 1 ||
            (!stick->circular && stick->deadzone) ||
            stick->opposition_x > GP_DEEPER_WINS || stick->opposition_y > GP_DEEPER_WINS) return 0;
    }
    return 1;
}

int gp_bound(const GpConfig *config, uint8_t key) {
    if (key >= GP_KEY_COUNT) return 0;
    for (unsigned i = 0; i < 10; ++i) if (config->analog[i].key == key) return 1;
    for (unsigned i = 0; i < 14; ++i) if (config->digital[i].key == key) return 1;
    return 0;
}

void gp_reset(GpState *state) {
    *state = (GpState){0};
    state->needs_release = 1;
}

static uint16_t gp_depth(const uint16_t *positions, uint8_t key) {
    if (key == GP_NONE) return 0;
    return positions[key] >= 1000 ? GP_TRAVEL_MAX : positions[key] * 10u;
}

static uint16_t gp_analog(const GpAnalog *binding, const uint16_t *positions) {
    const uint16_t depth = gp_depth(positions, binding->key);
    if (depth <= binding->start) return 0;
    if (depth >= binding->end) return binding->y[3];
    const int32_t x = (int32_t)(depth - binding->start) * GP_TRAVEL_MAX /
                      (binding->end - binding->start);
    if (x < binding->x[0]) return 0;
    for (unsigned i = 1; i < 4; ++i)
        if (x <= binding->x[i])
            return binding->y[i - 1] + (x - binding->x[i - 1]) *
                   ((int32_t)binding->y[i] - binding->y[i - 1]) /
                   (binding->x[i] - binding->x[i - 1]);
    return binding->y[3];
}

static int32_t gp_axis(uint16_t negative, uint16_t positive, uint8_t opposition) {
    if (opposition == GP_NEUTRAL_ON_BOTH && negative && positive) return 0;
    if (opposition == GP_DEEPER_WINS)
        return positive == negative ? 0 : positive > negative ? positive : -(int32_t)negative;
    return (int32_t)positive - negative;
}

static uint32_t gp_sqrt(uint32_t value) {
    uint32_t root = 0, bit = 1u << 30;
    while (bit > value) bit >>= 2;
    while (bit) {
        if (value >= root + bit) {
            value -= root + bit;
            root = (root >> 1) + bit;
        } else root >>= 1;
        bit >>= 2;
    }
    return root;
}

static int16_t gp_signed_axis(int32_t value) {
    return value >= 0 ? value * 32767 / 10000 : value * 32768 / 10000;
}

static void gp_stick(const GpStick *config, int32_t x, int32_t y,
                     int16_t *output_x, int16_t *output_y) {
    if (config->circular) {
        const uint32_t squared = (uint32_t)(x * x) + (uint32_t)(y * y);
        uint32_t radius = gp_sqrt(squared);
        if (radius * radius < squared) ++radius;
        if (radius <= config->deadzone) {
            *output_x = *output_y = 0;
            return;
        }
        const uint32_t clamped = radius > GP_TRAVEL_MAX ? GP_TRAVEL_MAX : radius;
        const uint32_t scaled = (clamped - config->deadzone) * GP_TRAVEL_MAX /
                                (GP_TRAVEL_MAX - config->deadzone);
        x = x * (int32_t)scaled / (int32_t)radius;
        y = y * (int32_t)scaled / (int32_t)radius;
    }
    *output_x = gp_signed_axis(x);
    *output_y = gp_signed_axis(y);
}

static int gp_released(const GpConfig *config, const uint16_t *positions) {
    for (unsigned i = 0; i < 10; ++i)
        if (gp_depth(positions, config->analog[i].key) > config->analog[i].start) return 0;
    for (unsigned i = 0; i < 14; ++i)
        if (gp_depth(positions, config->digital[i].key) > config->digital[i].release) return 0;
    return 1;
}

VERIFY_ENTRY __attribute__((section(".extra"),noinline)) int gp_update(GpState *state, const GpConfig *config,
              const uint16_t positions[GP_KEY_COUNT], int complete,
              uint32_t now) {
    if (!complete || !positions) {
        gp_reset(state);
        return 0;
    }
    state->last_frame_tick = now;
    state->has_frame = 1;
    state->report = (GpReport){0};
    if (config->mode == GP_OFF) {
        state->needs_release = 1;
        state->digital_latches = 0;
        return 1;
    }
    if (state->needs_release) {
        if (gp_released(config, positions)) state->needs_release = 0;
        return 1;
    }
    uint16_t analog[10];
    for (unsigned i = 0; i < 10; ++i) analog[i] = gp_analog(&config->analog[i], positions);
    int16_t axes[4];
    for (unsigned i = 0; i < 2; ++i) {
        const unsigned offset = i * 4;
        const GpStick *stick = &config->stick[i];
        const int32_t x = gp_axis(analog[offset], analog[offset + 1], stick->opposition_x);
        const int32_t y = gp_axis(analog[offset + 3], analog[offset + 2], stick->opposition_y);
        gp_stick(stick, x, y, &axes[2 * i], &axes[2 * i + 1]);
    }
    GpReport *report = &state->report;
    report->lx = axes[0]; report->ly = axes[1];
    report->rx = axes[2]; report->ry = axes[3];
    report->lt = (uint32_t)analog[8] * 255 / GP_TRAVEL_MAX;
    report->rt = (uint32_t)analog[9] * 255 / GP_TRAVEL_MAX;
    uint16_t held = 0;
    for (unsigned i = 0; i < 14; ++i) {
        const GpDigital *binding = &config->digital[i];
        if (binding->key == GP_NONE) continue;
        const uint16_t depth = gp_depth(positions, binding->key);
        if (state->digital_latches & (1u << i) ? depth > binding->release : depth >= binding->press)
            held |= 1u << i;
    }
    state->digital_latches = held;
    report->buttons = held & 0x3ff;
    report->dpad = held >> 10;
    if ((report->dpad & 3) == 3) report->dpad &= ~3u;
    if ((report->dpad & 12) == 12) report->dpad &= ~12u;
    return 1;
}

int gp_watchdog(GpState *state, uint32_t now, uint32_t max_age) {
    if (!state->has_frame || (uint32_t)(now - state->last_frame_tick) <= max_age) return 0;
    gp_reset(state);
    return 1;
}

static void gp_le16(uint8_t *output, uint16_t value) {
    output[0] = value;
    output[1] = value >> 8;
}

VERIFY_ENTRY __attribute__((section(".extra"),noinline)) void gp_encode(const GpReport *report, uint8_t output[20]) {
    for (unsigned i = 0; i < 20; ++i) output[i] = 0;
    output[1] = 20;
    const uint16_t masks[10] = {0x1000, 0x2000, 0x4000, 0x8000, 0x0100,
                              0x0200, 0x0020, 0x0010, 0x0040, 0x0080};
    uint16_t buttons = report->dpad;
    for (unsigned i = 0; i < 10; ++i)
        if (report->buttons & (1u << i)) buttons |= masks[i];
    gp_le16(output + 2, buttons);
    output[4] = report->lt;
    output[5] = report->rt;
    gp_le16(output + 6, report->lx);
    gp_le16(output + 8, report->ly);
    gp_le16(output + 10, report->rx);
    gp_le16(output + 12, report->ry);
}
