// Read-only, synthetic browser validation checks. Never submits a form.
const UNSAFE = /password|passcode|otp|one.time|2fa|mfa|cvv|cvc|credit.card|debit.card|bank|payment|checkout|purchase|billing|delete|remove.account|unsubscribe|captcha|recaptcha|security.question/i;
const EDITABLE = new Set(['text', 'search', 'email', 'url', 'tel', 'number', 'textarea']);

export function shouldSkipForm(form) {
  const combined = [form.action, form.id, form.name, form.fields.map(f => [f.name, f.id, f.type, f.label].join(' ')).join(' ')].join(' ');
  if (UNSAFE.test(combined)) return 'Contains sensitive, payment, authentication or destructive controls';
  if (form.fields.some(f => ['password', 'file', 'hidden'].includes(f.type) && f.type !== 'hidden')) return 'Contains password or file-upload controls';
  return '';
}

export function plannedScenarios(field) {
  if (!field || field.disabled || field.readOnly || field.hidden || !EDITABLE.has(field.type) && field.tag !== 'select' && field.type !== 'checkbox') return [];
  const out = [];
  if (field.required && (EDITABLE.has(field.type) || field.tag === 'select' || field.type === 'checkbox')) out.push({name:'required-empty', value:'', expectedFlag:'valueMissing'});
  if (field.type === 'email') out.push({name:'invalid-email', value:'not-an-email', expectedFlag:'typeMismatch'});
  if (field.type === 'url') out.push({name:'invalid-url', value:'not-a-url', expectedFlag:'typeMismatch'});
  if ((field.type === 'text' || field.tag === 'textarea') && field.minLength > 1) out.push({name:'too-short', value:'x', expectedFlag:'tooShort'});
  if (field.type === 'number' && field.min !== '' && Number.isFinite(Number(field.min))) out.push({name:'below-minimum', value:String(Number(field.min)-1), expectedFlag:'rangeUnderflow'});
  if (field.type === 'number' && field.max !== '' && Number.isFinite(Number(field.max))) out.push({name:'above-maximum', value:String(Number(field.max)+1), expectedFlag:'rangeOverflow'});
  return out;
}

const EMPTY = () => ({formsDiscovered:0, formsTested:0, fieldsTested:0, passed:0, failed:0, skipped:0, checks:[], forms:[], error:null});

async function inventory(page) {
  return page.locator('form').evaluateAll(forms => forms.slice(0,25).map((form, index) => ({
    index,
    id: form.id || '',
    name: form.getAttribute('name') || '',
    action: form.getAttribute('action') || '',
    method: (form.getAttribute('method') || 'GET').toUpperCase(),
    fields: Array.from(form.querySelectorAll('input,select,textarea')).map((f, fieldIndex) => {
      const css = getComputedStyle(f);
      const rect = f.getBoundingClientRect();
      return {
        index:fieldIndex, name:f.getAttribute('name') || '', id:f.id || '', tag:f.tagName.toLowerCase(),
        label:(f.labels?.[0]?.textContent || f.getAttribute('aria-label') || f.getAttribute('placeholder') || '').trim().slice(0,100),
        type:(f.getAttribute('type') || (f.tagName.toLowerCase()==='textarea'?'textarea':f.tagName.toLowerCase()==='select'?'select':'text')).toLowerCase(),
        required:f.required, disabled:f.disabled, readOnly:f.readOnly || false,
        hidden:css.display==='none' || css.visibility==='hidden' || rect.width===0 || rect.height===0,
        minLength:f.minLength, min:f.getAttribute('min') || '', max:f.getAttribute('max') || '',
        hasEmptyOption:f.tagName.toLowerCase()==='select' && Array.from(f.options).some(o => o.value==='')
      };
    })
  })));
}

/**
 * Open an isolated tab. All non-GET requests are blocked; no submit buttons are
 * clicked and no personal data is used. Only browser constraint validation is
 * asserted, so custom submit-only validation is deliberately NOT claimed tested.
 */
export async function auditForms(browser, targetUrl, {maxForms=3, maxScenarios=12, validateUrl, onFailure}={}) {
  const result = EMPTY();
  const context = await browser.newContext({viewport:{width:1366,height:820}, serviceWorkers:'block', acceptDownloads:false});
  const page = await context.newPage();
  const allowed = new Map();
  const origin = new URL(targetUrl).origin;
  try {
    await page.route('**/*', async route => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        if (!['http:', 'https:'].includes(url.protocol)) return route.abort();
        if (!['GET','HEAD'].includes(request.method())) return route.abort();
        if (request.isNavigationRequest() && url.origin !== origin) return route.abort();
        if (validateUrl) {
          const key = url.hostname;
          if (!allowed.has(key)) allowed.set(key, Promise.resolve().then(() => validateUrl(url.href)).then(() => true, () => false));
          if (!await allowed.get(key)) return route.abort();
        }
        return route.continue();
      } catch { return route.abort(); }
    });
    await page.goto(targetUrl,{waitUntil:'domcontentloaded',timeout:22000});
    await page.waitForTimeout(450);
    const forms = await inventory(page);
    result.formsDiscovered = forms.length;
    for (const form of forms.slice(0,Math.max(1,maxForms))) {
      const reason = shouldSkipForm(form);
      const entry = {index:form.index, name:form.name || form.id || 'Form '+(form.index+1), fields:form.fields.length, status:reason?'skipped':'tested', reason};
      result.forms.push(entry);
      if (reason) { result.skipped++; continue; }
      result.formsTested++;
      let performed = 0;
      for (const field of form.fields) {
        if (performed >= maxScenarios) break;
        const plans = plannedScenarios(field);
        for (const test of plans) {
          if (performed >= maxScenarios) break;
          if (field.tag === 'select' && !field.hasEmptyOption) { result.skipped++; continue; }
          const selector = 'form >> nth='+form.index+' >> css=input,select,textarea >> nth='+field.index;
          const locator = page.locator('form').nth(form.index).locator('input,select,textarea').nth(field.index);
          const label = field.label || field.name || field.id || 'Field '+(field.index+1);
          performed++;
          try {
            if (field.type === 'checkbox') await locator.uncheck({timeout:1800});
            else if (field.tag === 'select') await locator.selectOption('',{timeout:1800});
            else await locator.fill(test.value,{timeout:1800});
            await locator.evaluate(el => el.blur()).catch(()=>{});
            const actual = await locator.evaluate(el => ({
              valid:el.validity.valid,
              expectedFlag:el.validity.valueMissing?'valueMissing':
                el.validity.typeMismatch?'typeMismatch':
                el.validity.tooShort?'tooShort':
                el.validity.rangeUnderflow?'rangeUnderflow':
                el.validity.rangeOverflow?'rangeOverflow':'none'
            }));
            const passed = actual.expectedFlag === test.expectedFlag;
            const check = {form:entry.name, field:label, fieldType:field.type, scenario:test.name,
              status:passed?'passed':'failed', expected:test.expectedFlag, observed:actual.expectedFlag,
              selector, note:passed?'Browser constraint correctly rejected synthetic invalid input':'Browser constraint did not reject synthetic invalid input'};
            result.checks.push(check);
            if (passed) result.passed++;
            else {
              result.failed++;
              if (onFailure && result.failed <= 6) await onFailure(page, check);
            }
          } catch (error) {
            result.skipped++;
            result.checks.push({form:entry.name,field:label,fieldType:field.type,scenario:test.name,status:'skipped',selector,
              note:'Could not safely inspect field: '+String(error.message || error).slice(0,180)});
          }
        }
      }
    }
  } catch (error) {
    result.error = String(error.message || error).slice(0,350);
  } finally {
    await context.close().catch(()=>{});
  }
  result.fieldsTested = new Set(result.checks.filter(c=>c.status!=='skipped').map(c=>c.form+'|'+c.field)).size;
  return result;
}
