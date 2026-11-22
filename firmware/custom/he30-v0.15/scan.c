/* ADC1 regular sequence for one sensor bank. DMA1 channel 1 is independent
 * of the LED channels. */
static void fast_adc_setup(void){
 u32 ranks[2]={0,0};
#ifdef HE30_FN_RGB
 const u8 trial=S->scan_trial;
 const u8 sample=trial||S->library.fast==2?1:S->library.fast==1?2:3;
#ifdef HE30_CALIBRATION_QOL
 const int longer=trial==2||trial==6;
 /* The first rank is a throwaway on every bank with the configured scanner. */
 S->scan_order=!trial||trial==5?2:trial==3||trial==6;
#else
 const int longer=trial==2||trial==6||(!trial&&S->library.fast==2);
 S->scan_order=trial==5?2:(trial==3||trial==6||(!trial&&S->library.fast==2));
#endif
 const u32 count=S->scan_order==2?13:12;
 for(u32 i=0;i<12;i++){
  /* Swap ADC6 and ADC10, or prepend one ADC6 conversion for the discard test. */
  u32 index=S->scan_order==2?(i?i-1:0):S->scan_order==1&&(i==0||i==11)?11-i:i;
  ranks[i/6]|=(u32)channels[index]<<((i%6)*5);
 }
#else
 for(u32 i=0;i<12;i++)ranks[i/6]|=(u32)channels[i]<<((i%6)*5);
#endif
 MM32(0x40021004)=(MM32(0x40021004)&~0xf800u)|0xa000u; /* APB2 / 2, ADC / 6 */
#ifdef HE30_FN_RGB
 MM32(0x4001242c)=((count-1)<<20)|(count==13?channels[11]:0);
#else
 MM32(0x4001242c)=11u<<20;
#endif
 MM32(0x40012430)=ranks[1];
 MM32(0x40012434)=ranks[0];
 MM32(0x40012404)=0x100;
#ifdef HE30_ADC_RGB_FIX
 /* CH32 drops DMA register writes while the AHB DMA1 clock is gated. */
 MM32(0x40021014)|=1;
#endif
#ifdef HE30_FN_RGB
 MM32(0x4001240c)=0x249249u*sample;
 MM32(0x40012410)=0x09249249u*sample+(longer?(1u<<18):0);
 MM32(0x40020008)=0;
 MM32(0x40020010)=0x4001244c;
#else
 MM32(0x4001240c)=S->library.fast==2?0x249249:0x492492;
 MM32(0x40012410)=S->library.fast==2?0x09249249:0x12492492;
#endif
#ifndef HE30_ADC_RGB_FIX
 MM32(0x40021014)|=1;
#endif
}

static void rgb_cleanup(void);

static u8 scan_init(void){
 if(S->rgb_state==1||S->rgb_state==2){rgb_cleanup();S->rgb_pending=3;}
 u8 error=adc_init();
 S->running_fast=error?0:S->library.fast;
#ifdef HE30_FN_RGB
 if(!error)fast_adc_setup();
#ifdef HE30_ADC_RGB_FIX
 if(!error&&MM32(0x40020010)!=0x4001244c)error=3;
#endif
#else
 if(S->running_fast)fast_adc_setup();
#endif
 S->scan_hz=0;S->scan_worst=0;S->scan_sample_start=ticks();S->scan_sample_frames=S->frames;
 return error;
}

#ifdef HE30_FN_RGB
__attribute__((section(".fncode"),noinline)) static u8 restart_scan(void){
 all_released();S->startup_frames=0;S->scan_error=scan_init();
 S->enabled=typing_requested();S->first_frame=0;
 return S->scan_error?ADC:OK;
}
#endif

#ifdef HE30_FN_RGB
VERIFY_ENTRY
#endif
static u8 adc_frame_fast(u16 *out){
#ifdef HE30_FN_RGB
 const u8 order=S->scan_order;
 const u32 settling=S->scan_trial||S->running_fast==2?120:S->running_fast==1?400:720;
 u16 discard[13];
#endif
 for(u32 group=0;group<3;group++){
  banks_off();
  u8 bank=S->cfg.groups[group];
  if(bank==2)MM32(0x40010c14)=0x400;
  else MM32(0x40011014)=0x2000u<<bank;
#ifndef HE30_FN_RGB
  const u32 settling=S->running_fast==2?120:400;
#endif
  delay(settling);
#ifdef HE30_FN_RGB
  if(S->scan_trial==4
#ifdef HE30_CALIBRATION_QOL
     ||(!S->scan_trial&&!group)
#endif
  ){
   const u32 enabled=ticks();
   while(ticks()-enabled<2u*TICKS_MS/1000u){}
  }
#endif
  MM32(0x40020008)=0;
  MM32(0x40020004)=15;
#ifdef HE30_FN_RGB
  MM32(0x4002000c)=order==2?13:12;
  MM32(0x40020014)=(u32)(order==2?discard:out+12*group);
#else
  MM32(0x4002000c)=12;
  MM32(0x40020010)=0x4001244c;
  MM32(0x40020014)=(u32)(out+12*group);
#endif
  MM32(0x40020008)=0x2581;
  MM32(0x40012400)=0;
  MM32(0x40012408)=0x5e0101;
  const u32 start=ticks();
  while(!(MM32(0x40020000)&10)){
   if(ticks()-start>TICKS_MS)break;
  }
  MM32(0x40020008)=0;
  u32 flags=MM32(0x40020000);
  if((flags&10)!=2){banks_off();MM32(0x40012408)=0;return 3;}
#ifdef HE30_FN_RGB
  u16 *bank_out=out+12*group;
  if(order==1){const u16 first=bank_out[0];bank_out[0]=bank_out[11];bank_out[11]=first;}
  if(order==2){
#ifdef HE30_CALIBRATION_QOL
   for(u32 i=0;i<12;i++)bank_out[i]=discard[i+1];
#else
   bytes_copy(bank_out,discard+1,24);
#endif
  }
#endif
 }
 banks_off();return 0;
}

static u8 adc_frame(u16 *out){
 u32 start=ticks();
 /* Fast mode changes take effect at reboot or explicit scanner retry. */
#ifdef HE30_FN_RGB
 u8 error=adc_frame_fast(out);
#else
 u8 error=S->running_fast?adc_frame_fast(out):adc_frame_slow(out);
#endif
 u32 end=ticks(),span=end-start,window=end-S->scan_sample_start;
 S->scan_ticks=span;
 if(span>S->scan_worst)S->scan_worst=span;
 if(window>=100*TICKS_MS){
  u32 rate=(S->frames-S->scan_sample_frames)*1440000u/(window/100u);
  S->scan_hz=rate>65535?65535:rate;
  S->scan_sample_start=end;S->scan_sample_frames=S->frames;
 }
 return error;
}
