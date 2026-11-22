/* Hooks execute inside the pinned native USBHS handler. The C call uses the
 * IRQ's saved caller registers and preserves its live frame pointer s0.
 * KEEP(.usb_hooks) in the linker script retains these binary patch targets.
 */
.section .usb_hooks,"ax",@progbits
.align 2
.global usb_setup_hook
.type usb_setup_hook,@function
usb_setup_hook:
 addi sp,sp,-16
 sw ra,12(sp)
 call usb_gamepad_control
 beqz a0,1f
 lw ra,12(sp)
 addi sp,sp,16
 li t0,0x63be
 jr t0
1:
 lw ra,12(sp)
 addi sp,sp,16
 lbu a5,-2003(gp)
 li t0,0x5c32
 jr t0
.size usb_setup_hook,.-usb_setup_hook

.align 2
.global usb_endpoint_init_hook
.type usb_endpoint_init_hook,@function
usb_endpoint_init_hook:
#ifdef HE30_DESKTOP_KEYS
 /* EP4 OUT remains the vendor transport. Give EP4 IN its own DMA word. */
 li t0,0x4002346c
 li t1,0x200036dc
 sw t1,0(t0)
 li t0,0x400234ea
 li t1,2
 sb t1,0(t0)
 sb zero,320(gp)
#endif
#ifdef HE30_NKRO
 /* Report protocol is the USB default after a bus reset. */
 li t0,1
 sb t0,-1984(gp)
#endif
 /* RX3 owns 32 aligned bytes just above the donor's BSS end 0x200036d4.
  * The configuration advertises a 32-byte OUT packet for LED/rumble commands.
  * The keyboard has no motors, so the OUT handler acknowledges and consumes.
  */
 li t0,0x40023428
 li t1,0x200036e0
 sw t1,0(t0)
 li t0,0x400234a4
 li t1,32
 sh t1,0(t0)
 li t0,0x400234e7
 sb zero,0(t0)
 /* Replay the replaced epilogue, then restore s0/sp in the native code. */
 lw ra,12(sp)
 li t0,0x540c
 jr t0
.size usb_endpoint_init_hook,.-usb_endpoint_init_hook

.align 2
.global usb_out_hook
.type usb_out_hook,@function
usb_out_hook:
 li a4,3
 beq a5,a4,2f
 li a4,4
 beq a5,a4,1f
 li t0,0x5b76
 jr t0
1:
 li t0,0x5a5a
 jr t0
2:
 /* Match the native vendor OUT toggle validation and rearm sequence. */
 lbu a4,-102(s0)
 andi a4,a4,0x40
 beqz a4,3f
 li t0,0x400234e7
 lbu a4,0(t0)
 xori a4,a4,8
 andi a4,a4,0x18
 sb a4,0(t0)
3:
 li t0,0x5b98
 jr t0
.size usb_out_hook,.-usb_out_hook

#ifdef HE30_DESKTOP_KEYS
.section .usb_hooks,"ax",@progbits
.align 2
.global usb_mouse_in_hook
.type usb_mouse_in_hook,@function
usb_mouse_in_hook:
 li a4,0x24
 bne a5,a4,1f
 li t0,0x400234ea
 lbu a4,0(t0)
 andi a4,a4,-4
 xori a4,a4,8
 ori a4,a4,2
 sb a4,0(t0)
 sb zero,320(gp)
 li t0,0x5b98
 jr t0
1:
 li a4,33
 li t0,0x57f6
 jr t0
.size usb_mouse_in_hook,.-usb_mouse_in_hook
#endif
