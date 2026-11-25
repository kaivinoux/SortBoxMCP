package com.iaforeveryone.sortboxemail;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SortBoxPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
