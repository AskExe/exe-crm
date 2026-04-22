#!/bin/sh

echo "Injecting runtime environment variables into index.html..."

CONFIG_BLOCK=$(cat << EOF
    <script id="twenty-env-config">
      window._env_ = {
        REACT_APP_SERVER_BASE_URL: "$REACT_APP_SERVER_BASE_URL"
      };
    </script>
    <!-- END: Exe CRM Config -->
EOF
)
# Use sed to replace the config block in index.html
# Using pattern space to match across multiple lines
echo "$CONFIG_BLOCK" | sed -i.bak '
  /<!-- BEGIN: Exe CRM Config -->/,/<!-- END: Exe CRM Config -->/{
    /<!-- BEGIN: Exe CRM Config -->/!{
      /<!-- END: Exe CRM Config -->/!d
    }
    /<!-- BEGIN: Exe CRM Config -->/r /dev/stdin
    /<!-- END: Exe CRM Config -->/d
  }
' build/index.html
rm -f build/index.html.bak
