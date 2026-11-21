OUTPUT_ARCH(riscv)
ENTRY(firmware_main)
MEMORY { CODE(rx) : ORIGIN = 0x1B000, LENGTH = 0x3000
         EARLY(rx) : ORIGIN = 0x19800, LENGTH = 0x800
         EXTRA(rx) : ORIGIN = 0x1A200, LENGTH = 0xE00
         RAMCODE(rwx) : ORIGIN = 0x20007000, LENGTH = 0x400 }
SECTIONS {
 .early : { *(.early) . = ALIGN(4); } > EARLY
 .extra : { *(.extra) . = ALIGN(4); } > EXTRA
 .text : { KEEP(*(.entry)) *(.text*) *(.rodata*) . = ALIGN(4); } > CODE
 .layout 0 (INFO) : { KEEP(*(.layout)) }
 .ramcode : { __ramcode_start = .; KEEP(*(.ramcode*)) . = ALIGN(4); __ramcode_end = .; } > RAMCODE AT> CODE
 __ramcode_load = LOADADDR(.ramcode);
 .data : { *(.data*) *(.sdata*) } > RAMCODE AT> CODE
 .bss (NOLOAD) : { *(.bss*) *(.sbss*) *(COMMON) } > RAMCODE
 /DISCARD/ : { *(.comment) *(.eh_frame*) *(.riscv.attributes) }
 ASSERT(SIZEOF(.data) == 0, "No implicit data initialization permitted")
 ASSERT(SIZEOF(.bss) == 0, "State must use reserved explicit SRAM")
 ASSERT(SIZEOF(.ramcode) <= 0x400, "RAM flash writer exceeds reservation")
 ASSERT(LOADADDR(.ramcode) + SIZEOF(.ramcode) <= 0x1E000, "Code overlaps persistence pages")
}
