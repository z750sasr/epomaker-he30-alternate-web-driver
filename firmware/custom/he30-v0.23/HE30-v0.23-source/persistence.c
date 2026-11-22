/* The 4 KiB journal retains four complete profiles and shared controller tuning.
 * Keys omit their required-zero reserved byte. Lighting omits reserved bytes
 * and packs its 0..32 palette channels into six bits. The public D2 format
 * stays 976 bytes. Encoding is streamed from RAM by the flash-resident journal writer.
 */
#define STORED_PROFILE_BYTES 905u
#define STORED_GAMEPAD_OFFSET (180u+PROFILE_COUNT*STORED_PROFILE_BYTES)
_Static_assert(STORED_GAMEPAD_OFFSET+GP_CONFIG_BYTES==4092,"journal payload");

FLASH_EXEC
static u8 stored_byte(u32 offset){
 const u8 *library=(const u8 *)&S->library;
 if(offset<180)return library[offset];
 if(offset>=4092)return ((const u8 *)&S->library.commit)[offset-4092];
 if(offset>=STORED_GAMEPAD_OFFSET)return ((const u8 *)&G->config)[offset-STORED_GAMEPAD_OFFSET];
 const u32 index=(offset-180)/STORED_PROFILE_BYTES;
 const u32 local=(offset-180)%STORED_PROFILE_BYTES;
 const Profile *profile=&S->library.profiles[index];
 const u8 *source=(const u8 *)profile;
 if(local<468)return source[(local/13)*14+local%13];
 if(local<480)return ((const u8 *)&profile->light)[local-468];
 if(local<561){
  const u32 bit=(local-480)*8,channel=bit/6,shift=bit%6;
  const u8 *palette=(const u8 *)profile->light.palette;
  u32 value=palette[channel]>>shift;
  if(channel+1<108)value|=(u32)palette[channel+1]<<(6-shift);
  return value;
 }
 return source[632+local-561];
}

__attribute__((section(".text.first"),noinline)) static u32 stored_crc(const u8 *record){
 u32 crc=~0u;
 for(u32 i=4;i<4092;i++){
  if(i==12)i=16;
  const u8 value=record?record[i]:stored_byte(i);
  crc=crc_update(crc,&value,1);
 }
 return ~crc;
}

static void stored_load(const u8 *record){
 bytes_zero(&S->library,sizeof(Library));
 bytes_copy(&S->library,record,180);
 for(u32 i=0;i<PROFILE_COUNT;i++){
  Profile *profile=&S->library.profiles[i];
  const u8 *source=record+180+i*STORED_PROFILE_BYTES;
  for(u32 k=0;k<N;k++)bytes_copy(&profile->keys[k],source+k*13,13);
  bytes_copy(&profile->light,source+468,12);
  u8 *palette=(u8 *)profile->light.palette;
  for(u32 c=0;c<108;c++){
   const u32 bit=c*6,index=bit/8,shift=bit%8;
   u32 value=source[480+index];
   if(index+1<81)value|=(u32)source[481+index]<<8;
   palette[c]=(value>>shift)&63;
  }
  bytes_copy(profile->fn2,source+561,344);
 }
 bytes_copy(&G->config,record+STORED_GAMEPAD_OFFSET,GP_CONFIG_BYTES);
 if(!gp_valid(&G->config))gp_defaults(&G->config);
 S->library.commit=COMMIT;
}
