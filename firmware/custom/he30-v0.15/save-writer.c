#ifdef HE30_FLASH_RESIDENT_SAVE
/* On a read-protected CH32V305, fast programming must run from zero-wait flash. */
#define FLASH_EXEC __attribute__((section(".flashwriter"),noinline,noclone))
#else
#define FLASH_EXEC __attribute__((section(".ramflash"),noinline,noclone))
#endif
#define SAVE_TRACE_MAGIC 0x31533348u /* H3S1 */
enum SaveStage {
 SAVE_RELEASE=1, SAVE_CAPTURE, SAVE_MASK_IRQ, SAVE_CLOCK, SAVE_UNLOCK,
 SAVE_ERASE, SAVE_LOAD, SAVE_PROGRAM, SAVE_VERIFY, SAVE_RESTORE, SAVE_DONE
};
typedef struct {
 u32 magic,stage,address,status,control,result,failed;
} SaveTrace;
#define SAVE_TRACE ((volatile SaveTrace *)0x20007400u)
#define SAVE_STAGE(value) (SAVE_TRACE->stage=(value))
#ifndef HE30_FLASH_RESIDENT_SAVE
extern const u8 __ramflash_source[],__ramflash_begin[],__ramflash_end[];

__attribute__((noinline)) static void prepare_flash_worker(void){
 bytes_copy((void *)__ramflash_begin,__ramflash_source,(u32)(__ramflash_end-__ramflash_begin));
 __asm__ volatile("fence.i":::"memory");
}
#endif
