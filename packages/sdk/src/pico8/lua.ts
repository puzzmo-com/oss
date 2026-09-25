/**
 * The cart's half of the PICO-8 bridge, as Lua source.
 *
 * `puzzmoPico8()` writes this next to the cart as `puzzmo.lua`, and the cart pulls it in with `#include puzzmo.lua`.
 * It is a transliteration of `Pico8Channel` in ./channel.ts plus the messages in ./protocol.ts, so change them
 * together. Every token here comes out of the cart's 8192, so it is written to be small rather than pretty.
 */
export const puzzmoLua = `-- puzzmo.lua: connects your cart to
-- puzzmo. written by @puzzmo/sdk,
-- edits here will be overwritten.
--
-- pz_init()    call in _init
-- pz_update()  call first in _update
--
-- pz.ready     puzzle has arrived
-- pz.puzzle    today's puzzle
-- pz.progress  what pz_save saved
-- pz.started   ok to take input
-- pz.paused    stop taking input
-- pz.completed already solved
--
-- pz_save(str)       save progress
-- pz_deed(id,n)      a stat for
--                    leaderboards
-- pz_complete(n,str) solved! with
--                    n points
-- pz_finished()      win anim done
--
-- define these to hear about things:
-- pz_on_ready(), pz_on_start(),
-- pz_on_retry()

pz={started=false,paused=false,
 completed=false,ready=false,
 puzzle="",progress=""}

function pz_init()
 -- carry on from the seqs already in
 -- the mailboxes: a reset cart must
 -- not reuse one the page has seen
 pz_iseq,pz_oseq=@0x5f80,@0x5fc0
 pz_q,pz_pend,pz_wait={},nil,0
 pz_send(1)
end

function pz_send(op,p)
 add(pz_q,{op=op,p=p or {}})
end

function pz_update()
 local s=@0x5f80
 if (pz_iseq>0) poke(0x5fc3,pz_iseq)
 if s>0 and s!=pz_iseq then
  pz_iseq=s
  poke(0x5fc3,s)
  local p={}
  for i=1,@0x5f82 do p[i]=@(0x5f83+i) end
  pz_recv(@0x5f81,p)
 end
 if (pz_pend and @0x5f83==pz_oseq) pz_pend=nil
 local m=pz_pend
 if m then
  pz_wait+=1
  if (pz_wait<20) return
 else
  if (#pz_q==0) return
  m=deli(pz_q,1)
  pz_oseq=pz_oseq%255+1
 end
 for i=1,60 do poke(0x5fc3+i,m.p[i] or 0) end
 poke(0x5fc1,m.op,#m.p)
 poke(0x5fc0,pz_oseq)
 pz_pend,pz_wait=m,0
end

function pz_recv(op,p)
 if op==1 then
  pz.completed=p[1]&1>0
  pz_pb,pz_gb="",""
 elseif op==2 then
  for i=1,16 do pal(i-1,p[i],1) end
 elseif op==3 then
  pz.puzzle,pz.progress,pz.ready=pz_pb,pz_gb,true
  if (pz_on_ready) pz_on_ready()
  pz_send(2)
 elseif op==4 then
  pz.started=true
  if (pz_on_start) pz_on_start()
 elseif op==5 then
  pz.paused=p[1]==1
 elseif op==6 then
  pz.completed,pz.progress=false,""
  if (pz_on_retry) pz_on_retry()
 elseif op==7 then
  pz_pb..=pz_str(p)
 elseif op==8 then
  pz_gb..=pz_str(p)
 elseif pz_on_msg then
  pz_on_msg(op,p)
 end
end

function pz_save(s)
 s=tostr(s)
 pz.progress=s
 while #s>60 do
  pz_send(4,pz_bytes(sub(s,1,60)))
  s=sub(s,61)
 end
 pz_send(5,pz_bytes(s))
end

-- n is 0..32767, keep=true stores it
-- on the player's profile too
function pz_deed(id,n,keep)
 local p={n\\256,n%256,keep and 1 or 0}
 for c in all(pz_bytes(id)) do add(p,c) end
 pz_send(6,p)
end

function pz_complete(n,s)
 pz_save(s)
 pz_send(7,{n\\256,n%256})
 pz.completed=true
end

function pz_finished() pz_send(3) end

-- bytes to a string, and back
function pz_str(p)
 local s=""
 for v in all(p) do s..=chr(v) end
 return s
end

function pz_bytes(s)
 local p={}
 for i=1,#s do p[i]=ord(s,i) end
 return p
end
`
