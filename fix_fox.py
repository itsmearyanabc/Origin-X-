import json

def patch_content(content):
    # Find the script block and replace it
    old_script = """<script>
  window.addEventListener('load', () => {
    if (typeof ModelViewer !== 'undefined') {
      const viewer = ModelViewer({
        pxNotRatio: true,
        width: 120,
        height: 120,
        followMouse: true
      });
      document.getElementById('metamask-fox-container').appendChild(viewer.container);
    }
  });
</script>"""
    new_script = """<script>
  (function initFox() {
    if (typeof ModelViewer !== 'undefined') {
      const viewer = ModelViewer({
        pxNotRatio: true,
        width: 120,
        height: 120,
        followMouse: true
      });
      const container = document.getElementById('metamask-fox-container');
      if (container) {
          container.appendChild(viewer.container);
      }
    } else {
      setTimeout(initFox, 100);
    }
  })();
</script>"""
    return content.replace(old_script, new_script)

# 1. Patch Origin X Landing.dc.html
dc_path = "web/public/claude-design/Origin X Landing.dc.html"
with open(dc_path, "r") as f:
    dc_content = f.read()
with open(dc_path, "w") as f:
    f.write(patch_content(dc_content))

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
    
    template = patch_content(template)
    
    new_template_str = json.dumps(template)
    new_template_str = new_template_str.replace("</script>", "<\\/script>")
    
    new_html_content = html_content[:start_idx] + "\n" + new_template_str + "\n  " + html_content[end_idx:]
    with open(html_path, "w") as f:
        f.write(new_html_content)
    print("Fox fixed successfully!")
else:
    print("Could not find template tag.")
