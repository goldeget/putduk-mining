import { describe,expect,it } from "vitest";
import { confirmWithdrawalHoldRelease } from "../../apps/admin/lib/withdrawals/hold-release-receipt";
const id=(n:number)=>"12345678-1234-4234-9234-"+String(n).padStart(12,"0");
function receipt(){
  return {withdrawalId:id(1),returnedLedgerId:id(2),requestedDisposition:"CANCELLED" as const,
    withdrawal:{id:id(1),user_id:id(3),hold_ledger_transaction_id:id(4),release_ledger_transaction_id:id(2),
      status:"REJECTED",currency:"KRW",amount_atomic:"5000",fee_atomic:"0",rejection_reason:" original reason ",
      hold_released_at:"2026-10-12T00:00:00.123456+00:00"},
    ledger:{id:id(2),category:"REVERSAL",currency:"KRW",reference_type:"withdrawal_request",reference_id:id(1),
      member_user_id:id(3),reversal_of_transaction_id:id(4),metadata:{phase:"RELEASE",disposition:"REJECTED",reason:" original reason "},
      posted_at:"2026-10-12T00:00:00.123456+00:00"},
    entries:[{transaction_id:id(2),account_id:id(5),sequence:0,side:"DEBIT",amount_atomic:"5000"},
      {transaction_id:id(2),account_id:id(6),sequence:1,side:"CREDIT",amount_atomic:"5000"}]};
}
describe("HOLD release original receipt verifier; not wired to protected candidate195 API",()=>{
  it("returns the original rejection after a different-disposition replay",()=>{
    expect(confirmWithdrawalHoldRelease(receipt())).toEqual({ok:true,releaseLedgerTransactionId:id(2),
      disposition:"REJECTED",requestedDisposition:"CANCELLED",matchesRequestedDisposition:false});
  });
  it("confirms an identical disposition and preserves old reason/clock",()=>{
    const r=receipt();r.withdrawal.status="CANCELLED";r.ledger.metadata.disposition="CANCELLED";
    expect(confirmWithdrawalHoldRelease(r)).toMatchObject({ok:true,disposition:"CANCELLED",matchesRequestedDisposition:true});
  });
  it("accepts safe integer JSON money and reversed row ordering",()=>{
    const r=receipt();Object.assign(r.withdrawal,{amount_atomic:5000,fee_atomic:0});
    for(const entry of r.entries)Object.assign(entry,{amount_atomic:5000});
    r.entries.reverse();expect(confirmWithdrawalHoldRelease(r).ok).toBe(true);
  });
  for(const returnedLedgerId of [null,"",id(9)]){
    it("rejects null or unrelated RPC result "+String(returnedLedgerId),()=>{
      expect(confirmWithdrawalHoldRelease({...receipt(),returnedLedgerId})).toEqual({ok:false,code:"UNCONFIRMED"});
    });
  }
  for(const [field,value] of [["id",id(9)],["user_id",id(9)],["status","COMPLETED"],["release_ledger_transaction_id",id(9)],
    ["hold_ledger_transaction_id",id(9)],["currency","USDT"],["fee_atomic","1"],["amount_atomic","0"],
    ["amount_atomic",Number.MAX_SAFE_INTEGER+1],["hold_released_at","invalid"],["rejection_reason","different"]] as const){
    it("rejects mismatched withdrawal readback "+field,()=>{
      const r=receipt();Object.assign(r.withdrawal,{[field]:value});expect(confirmWithdrawalHoldRelease(r).ok).toBe(false);
    });
  }
  for(const [field,value] of [["id",id(9)],["category","WITHDRAWAL"],["currency","USDT"],["reference_id",id(9)],
    ["reference_type","another"],["member_user_id",id(9)],["reversal_of_transaction_id",id(9)],
    ["posted_at","2026-10-12T00:00:01+00:00"]] as const){
    it("rejects wrong reversal ledger "+field,()=>{
      const r=receipt();Object.assign(r.ledger,{[field]:value});expect(confirmWithdrawalHoldRelease(r).ok).toBe(false);
    });
  }
  it("requires raw original reason and metadata disposition agreement",()=>{
    const r=receipt();r.ledger.metadata.reason="original reason";expect(confirmWithdrawalHoldRelease(r).ok).toBe(false);
    const q=receipt();q.ledger.metadata.disposition="CANCELLED";expect(confirmWithdrawalHoldRelease(q).ok).toBe(false);
  });
  it("rejects missing, excess, same-account or unbalanced entries",()=>{
    for(const mode of ["missing","extra","same","amount","side","sequence"]){
      const r=receipt();
      if(mode==="missing")r.entries.pop();
      if(mode==="extra")r.entries.push({...r.entries[0]!});
      if(mode==="same")r.entries[1]!.account_id=r.entries[0]!.account_id;
      if(mode==="amount")r.entries[1]!.amount_atomic="4999";
      if(mode==="side")r.entries[0]!.side="CREDIT";
      if(mode==="sequence")r.entries[0]!.sequence=1;
      expect(confirmWithdrawalHoldRelease(r).ok).toBe(false);
    }
  });
});
