OUTPUT_ARCH(riscv)
ENTRY(firmware_main)
MEMORY { CODE(rx) : ORIGIN = 0x1B000, LENGTH = 0x3000
         EARLY(rx) : ORIGIN = 0x19158, LENGTH = 0xEA8
         SPARE(rx) : ORIGIN = 0x18C7C, LENGTH = 0x384
         EXTRA(rx) : ORIGIN = 0x1A200, LENGTH = 0xE00
         FNCODE(rx) : ORIGIN = 0xEA00, LENGTH = 0xF00
         RAMCODE(rwx) : ORIGIN = 0x20007000, LENGTH = 0x400 }
SECTIONS {
 .fncode : { *(.fncode) . = ALIGN(4); } > FNCODE
 .spare : { *(.spare) *(.spare_data) . = ALIGN(4); } > SPARE
 .early : { *(.early) . = ALIGN(4); } > EARLY
 .extra : { *(.extra) *(.extra_data) . = ALIGN(4); } > EXTRA
 .text : { KEEP(*(.entry)) *(.text.bytes_copy) KEEP(*(.usb_hooks)) *(.text.usb_ready) *(.text.first) *(.text*) *(.rodata*) . = ALIGN(4); } > CODE
 .layout 0 (INFO) : { KEEP(*(.layout)) }
 .flashwriter : { KEEP(*(.flashwriter)) . = ALIGN(4); } > CODE
 .ramflash : {
   __ramflash_begin = .;
   KEEP(*(.ramflash))
   . = ALIGN(4);
   __ramflash_end = .;
 } > RAMCODE AT> CODE
 __ramflash_source = LOADADDR(.ramflash);
 .data : { *(.data*) *(.sdata*) } > RAMCODE AT> CODE
 .bss (NOLOAD) : { *(.bss*) *(.sbss*) *(COMMON) } > RAMCODE
 /DISCARD/ : { *(.comment) *(.eh_frame*) *(.riscv.attributes) }
 ASSERT(SIZEOF(.data) == 0, "No implicit data initialization permitted")
 ASSERT(SIZEOF(.bss) == 0, "State must use reserved explicit SRAM")
 ASSERT(ADDR(.flashwriter) + SIZEOF(.flashwriter) <= 0x1E000, "Code overlaps persistence pages")
 ASSERT(LOADADDR(.ramflash) + SIZEOF(.ramflash) <= 0x1E000, "RAM flash writer load image overlaps persistence pages")
}
