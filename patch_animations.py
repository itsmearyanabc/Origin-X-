import json

patch_css_js = """
<style>
  [data-reveal="1"], [data-stagger="1"] > * {
    opacity: 0;
    transform: translateY(20px);
    transition: opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1), transform 0.8s cubic-bezier(0.16, 1, 0.3, 1);
    will-change: opacity, transform;
  }
  [data-reveal="1"].is-revealed, [data-stagger="1"].is-revealed > * {
    opacity: 1;
    transform: translateY(0);
  }
</style>
<script>
(function() {
  const init = () => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          if (entry.target.hasAttribute('data-stagger')) {
            Array.from(entry.target.children).forEach((child, i) => {
              child.style.transitionDelay = `${i * 0.12}s`;
            });
          }
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -50px 0px" });

    document.querySelectorAll('[data-reveal="1"], [data-stagger="1"]').forEach(el => {
      observer.observe(el);
    });

    const countObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const el = entry.target;
          const end = parseInt(el.textContent, 10) || 92;
          const duration = 1500;
          const startTime = performance.now();
          const parentGradient = el.closest('div[style*="conic-gradient"]');
          
          function update(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const easeProgress = 1 - Math.pow(1 - progress, 3);
            const currentVal = Math.floor(easeProgress * end);
            el.textContent = currentVal;
            
            if (parentGradient) {
               parentGradient.style.background = `conic-gradient(#F07824 0 ${currentVal}%,#F2F4F7 0)`;
            }

            if (progress < 1) {
              requestAnimationFrame(update);
            } else {
              el.textContent = end;
              if (parentGradient) parentGradient.style.background = `conic-gradient(#F07824 0 ${end}%,#F2F4F7 0)`;
            }
          }
          requestAnimationFrame(update);
          countObserver.unobserve(el);
        }
      });
    }, { threshold: 0.5 });

    const ninetyTwos = Array.from(document.querySelectorAll('*')).filter(el => 
      el.childNodes.length === 1 && 
      el.childNodes[0].nodeType === 3 && 
      el.textContent.trim() === '92'
    );
    ninetyTwos.forEach(el => countObserver.observe(el));
  };
  
  setTimeout(init, 50);
})();
</script>
</body>
"""

def inject(content):
    return content.replace("</body>", patch_css_js)

# 1. Patch Origin X Landing.dc.html
dc_path = "web/public/claude-design/Origin X Landing.dc.html"
with open(dc_path, "r") as f:
    dc_content = f.read()
with open(dc_path, "w") as f:
    f.write(inject(dc_content))

# 2. Patch Origin X Landing.html
html_path = "web/public/claude-design/Origin X Landing.html"
with open(html_path, "r") as f:
    html_content = f.read()

start_tag = '<script type="__bundler/template">'
end_tag = '</script>'
start_idx = html_content.find(start_tag)
if start_idx != -1:
    start_idx += len(start_tag)
    end_idx = html_content.find(end_tag, start_idx)
    
    template_str = html_content[start_idx:end_idx].strip()
    template = json.loads(template_str)
    
    template = inject(template)
    
    new_template_str = json.dumps(template)
    new_template_str = new_template_str.replace("</script>", "<\\/script>")
    
    new_html_content = html_content[:start_idx] + "\n" + new_template_str + "\n  " + html_content[end_idx:]
    with open(html_path, "w") as f:
        f.write(new_html_content)
    print("Injected scroll reveals and counter successfully!")
else:
    print("Could not find template tag.")
