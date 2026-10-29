import test from 'node:test';
import assert from 'node:assert/strict';
import {firstOrderTemperature, coolingTimeToTarget, buildCoolingSeries} from './coolingModel.js';
const near = (a, b, tol=1e-9) => assert.ok(Math.abs(a-b)<tol, `${a} vs ${b}`);
test('start temperature is unchanged at zero seconds',()=>near(firstOrderTemperature(95,25,180,0),95));
test('temperature after one tau has 1/e of initial difference',()=>near(firstOrderTemperature(95,25,180,180),25+70/Math.E));
test('temperature is decreasing toward ambient',()=>{
  const temperatures = [0,20,60,100,360].map(t=>firstOrderTemperature(95,25,180,t));
  assert.ok(temperatures.every((v,i)=>i===0||temperatures[i-1]>=v));
  assert.ok(temperatures.every(t=>t>25));
});
test('already at ambient remains constant',()=>near(firstOrderTemperature(25,25,90,1000),25));
test('ambient above initial warms the sensor, not cools',()=>{
  const v=firstOrderTemperature(20,40,100,100);assert.ok(v>20&&v<40);
});
test('invalid tau, negative time, or missing inputs are rejected',()=>{
  for (const bad of [0,-1,NaN,Infinity]) assert.equal(firstOrderTemperature(95,25,bad,30),null);
  assert.equal(firstOrderTemperature(null,25,180,30),null); // explicit null should not be treated as numeric
  assert.equal(firstOrderTemperature(95,25,180,-2),null);
});
test('analytic time to target matches exponential curve',()=>{
  const t=coolingTimeToTarget(95,25,180,45);
  near(firstOrderTemperature(95,25,180,t),45,1e-6);
});
test('target at or below ambient is not reached in finite time',()=>{
  assert.equal(coolingTimeToTarget(95,25,180,25),null);
  assert.equal(coolingTimeToTarget(95,25,180,15),null);
});
test('already below target returns zero',()=>assert.equal(coolingTimeToTarget(40,25,180,45),0));
test('warming trajectory cannot cross a lower target',()=>assert.equal(coolingTimeToTarget(95,110,180,45),null));
test('series always includes exact endpoint and is bounded',()=>{
  const series=buildCoolingSeries(95,25,180,53,10);
  assert.deepEqual(series.map(x=>x.elapsedSeconds),[0,10,20,30,40,50,53]);
  near(series[6].temperatureC,firstOrderTemperature(95,25,180,53));
});
test('invalid durations and overly dense series return empty',()=>{
  assert.deepEqual(buildCoolingSeries(90,25,180,10000,1),[]);
  assert.deepEqual(buildCoolingSeries(90,25,180,-1,10),[]);
});
