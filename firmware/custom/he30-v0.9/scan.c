/* ADC1 regular sequence of twelve channels. DMA1 channel 1 is independent
 * of the LED channels. The conservative one-shot path remains selectable. */
static void fast_adc_setup(void){
 u32 ranks[2]={0,0};
 for(u32 i=0;i<12;i++)ranks[i/6]|=(u32)channels[i]<<((i%6)*5);
 MM32(0x40021004)=(MM32(0x40021004)&~0xf800u)|0xa000u; /* APB2 / 2, ADC / 6 */
 MM32(0x4001242c)=11u<<20;
 MM32(0x40012430)=ranks[1];
 MM32(0x40012434)=ranks[0];
 MM32(0x40012404)=0x100;
 MM32(0x4001240c)=S->library.fast==2?0x249249:0x492492;
 MM32(0x40012410)=S->library.fast==2?0x09249249:0x12492492;
 MM32(0x40021014)|=1;
}

static void rgb_cleanup(void);

static u8 scan_init(void){
 if(S->rgb_state==1||S->rgb_state==2){rgb_cleanup();S->rgb_pending=3;}
 u8 error=adc_init();
 S->running_fast=error?0:S->library.fast;
 if(S->running_fast)fast_adc_setup();
 S->scan_hz=0;S->scan_worst=0;S->scan_sample_start=ticks();S->scan_sample_frames=S->frames;
 return error;
}

static u8 adc_frame_fast(u16 *out){
 for(u32 group=0;group<3;group++){
  banks_off();
  u8 bank=S->cfg.groups[group];
  if(bank==2)MM32(0x40010c14)=0x400;
  else MM32(0x40011014)=0x2000u<<bank;
  const u32 settling=S->running_fast==2?120:400;
  delay(settling);
  MM32(0x40020008)=0;
  MM32(0x40020004)=15;
  MM32(0x4002000c)=12;
  MM32(0x40020010)=0x4001244c;
  MM32(0x40020014)=(u32)(out+12*group);
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
 }
 banks_off();return 0;
}

static u8 adc_frame(u16 *out){
 u32 start=ticks();
 /* Fast mode changes take effect at reboot or explicit scanner retry. */
 u8 error=S->running_fast?adc_frame_fast(out):adc_frame_slow(out);
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
