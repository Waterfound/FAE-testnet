#!/usr/bin/env python3
import argparse,json,sys
P=argparse.ArgumentParser()
P.add_argument('result_json')
a=P.parse_args()
r=json.load(open(a.result_json))
base=json.load(open(r.get('baseline_path','BASELINE.json')))
if not r.get('parity_passed',False):
    print(json.dumps({'admissible':False,'verdict':'REJECT_PARITY_FAIL'},indent=2));sys.exit(2)
work=float(r['sustained_work_s'])
dur=float(r.get('duration_s',0))
throughput_multiple=work/base['same_laptop_browser_control']['work_s']
out={'admissible':dur>=1800,'throughput_multiple_vs_same_laptop_browser':throughput_multiple,'duration_s':dur}
out['cloud_rental_usd']=r.get('cloud_rental_usd')
out['hfb_verdict']='INCOMPLETE'
out['reason']='HFB requires trustworthy measured power and specialized-hardware acquisition/replacement cost versus the frozen home-device median.'
if all(k in r for k in ('measured_power_w','specialized_acquisition_cost_usd','home_median_work_per_w','home_median_work_per_dollar')):
    wpw=work/float(r['measured_power_w']);wpd=work/float(r['specialized_acquisition_cost_usd'])
    mw=wpw/float(r['home_median_work_per_w']);md=wpd/float(r['home_median_work_per_dollar'])
    out.update({'work_per_w':wpw,'work_per_dollar':wpd,'work_per_w_multiple':mw,'work_per_dollar_multiple':md})
    out['hfb_verdict']='COLLAPSE' if mw>=5 and md>=5 else ('WARN' if mw>=3 and md>=3 else 'HOLD')
    out['reason']='Both HFB dimensions supplied.'
print(json.dumps(out,indent=2,sort_keys=True))
